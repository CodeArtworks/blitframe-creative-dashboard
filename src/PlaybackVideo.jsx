import { useCallback, useEffect, useRef } from "react";

export function PlaybackVideo({ src, format, isComplete = false, onFatalError, autoPlay = false, ...videoProps }) {
  const videoRef = useRef(null);
  const onFatalErrorRef = useRef(onFatalError);
  const autoPlayRef = useRef(autoPlay);
  const fatalSourceRef = useRef("");

  autoPlayRef.current = autoPlay;

  useEffect(() => {
    onFatalErrorRef.current = onFatalError;
  }, [onFatalError]);

  const reportFatal = useCallback(() => {
    if (fatalSourceRef.current === src) {
      return;
    }
    fatalSourceRef.current = src;
    onFatalErrorRef.current?.();
  }, [src]);

  useEffect(() => {
    fatalSourceRef.current = "";
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      return undefined;
    }

    if (format !== "hls") {
      const positionPreviewFrame = () => {
        if (!autoPlayRef.current && video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(0.1, video.duration / 2);
        }
      };
      video.addEventListener("loadedmetadata", positionPreviewFrame);
      video.src = src;
      video.load();
      return () => {
        video.removeEventListener("loadedmetadata", positionPreviewFrame);
        video.removeAttribute("src");
        video.load();
      };
    }

    let disposed = false;
    let hls;
    let networkRecoveryAttempts = 0;
    let mediaRecoveryAttempts = 0;
    const playIfRequested = () => {
      if (autoPlayRef.current) {
        video.play().catch(() => {
          // Controls remain available when the browser blocks autoplay.
        });
      }
    };
    const handleNativeError = () => reportFatal();

    video.addEventListener("canplay", playIfRequested);
    video.addEventListener("loadeddata", playIfRequested);

    const attach = async () => {
      const { default: Hls } = await import("hls.js");
      if (disposed) {
        return;
      }
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.addEventListener("error", handleNativeError);
          video.src = src;
          video.load();
          playIfRequested();
          return;
        }
        reportFatal();
        return;
      }
      hls = new Hls({
        lowLatencyMode: true,
        maxBufferLength: 8,
        backBufferLength: 8,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) {
          return;
        }
        console.error("HLS playback failed", data.type, data.details, data.reason || "");
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveryAttempts < 2) {
          networkRecoveryAttempts += 1;
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
          mediaRecoveryAttempts += 1;
          hls.recoverMediaError();
          return;
        }
        reportFatal();
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        networkRecoveryAttempts = 0;
        mediaRecoveryAttempts = 0;
        playIfRequested();
      });
      hls.on(Hls.Events.MANIFEST_PARSED, playIfRequested);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
      hls.attachMedia(video);
    };
    attach().catch((error) => {
      console.error("HLS playback could not be attached", error);
      if (!disposed) {
        reportFatal();
      }
    });
    return () => {
      disposed = true;
      hls?.destroy();
      video.removeEventListener("error", handleNativeError);
      video.removeEventListener("canplay", playIfRequested);
      video.removeEventListener("loadeddata", playIfRequested);
      video.removeAttribute("src");
      video.load();
    };
  }, [format, reportFatal, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      return;
    }
    if (autoPlay) {
      video.play().catch(() => {
        // Controls remain available when the browser blocks programmatic autoplay.
      });
    } else {
      video.pause();
    }
  }, [autoPlay, src]);

  return <video ref={videoRef} autoPlay={autoPlay} {...videoProps} />;
}
