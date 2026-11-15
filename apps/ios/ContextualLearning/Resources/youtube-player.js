(function () {
  let player;
  let ready = false;
  let request;
  let videoID;
  let active = true;
  let networkFailed = false;
  let pendingStart = false;
  let mode = "once";
  let boundaryTimer;
  let repeatTimer;
  let awaitingSeek = false;
  let seekDeadline = 0;
  let completed = false;

  function report(state, code) {
    window.webkit.messageHandlers.youtubePlayer.postMessage({
      requestID: request ? request.id : null,
      state,
      code: code || 0,
    });
  }
  function cancelRepeat() {
    clearTimeout(repeatTimer);
    repeatTimer = undefined;
  }
  function stopBoundary() {
    clearInterval(boundaryTimer);
    boundaryTimer = undefined;
  }
  function bounded() {
    return (
      request &&
      mode !== "continuous" &&
      Number.isFinite(request.endSeconds) &&
      request.endSeconds > request.startSeconds
    );
  }
  function restart() {
    completed = false;
    awaitingSeek = true;
    seekDeadline = Date.now() + 1000;
    player.seekTo(request.startSeconds, true);
    player.playVideo();
  }
  function finish() {
    if (completed || !active || !bounded()) return;
    completed = true;
    stopBoundary();
    player.pauseVideo();
    if (mode === "loop") {
      report("loop-waiting");
      const id = request.id;
      repeatTimer = setTimeout(function () {
        repeatTimer = undefined;
        if (active && request && request.id === id && mode === "loop") restart();
      }, 500);
    } else report("completed");
  }
  function checkBoundary() {
    if (!active || !ready || !bounded() || completed || player.getPlayerState() !== 1) return;
    const time = player.getCurrentTime();
    if (!Number.isFinite(time)) return;
    // Ignore the previous segment's playhead while the asynchronous seek settles.
    if (awaitingSeek) {
      if (
        (time < request.startSeconds - 0.25 || time >= request.endSeconds) &&
        Date.now() < seekDeadline
      )
        return;
      awaitingSeek = false;
    }
    if (time >= request.endSeconds) finish();
  }
  function startBoundary() {
    stopBoundary();
    if (bounded()) boundaryTimer = setInterval(checkBoundary, 50);
  }
  function apply() {
    cancelRepeat();
    stopBoundary();
    if (networkFailed) {
      report("failed", -1);
      return;
    }
    if (!ready || !request) return;
    completed = false;
    awaitingSeek = true;
    seekDeadline = Date.now() + 1000;
    pendingStart = !active;
    if (videoID !== request.videoID) {
      videoID = request.videoID;
      player[active ? "loadVideoById" : "cueVideoById"]({
        videoId: videoID,
        startSeconds: request.startSeconds,
      });
    } else {
      player.seekTo(request.startSeconds, true);
      if (active) player.playVideo();
      else player.pauseVideo();
    }
  }
  window.CLLYouTubePlayer = {
    play(value) {
      if (request && value && request.id === value.id) return;
      request = value;
      apply();
    },
    setMode(value) {
      if (!["once", "loop", "continuous"].includes(value) || mode === value) return;
      mode = value;
      awaitingSeek = false;
      const waiting = repeatTimer !== undefined;
      cancelRepeat();
      if (waiting) report("completed");
      if (ready && active && request) startBoundary();
    },
    command(value) {
      if (!ready || !request) return;
      cancelRepeat();
      pendingStart = false;
      if (value === "pause") {
        stopBoundary();
        player.pauseVideo();
        report("paused");
      } else if (value === "resume" && active) {
        const time = player.getCurrentTime();
        if (completed || (bounded() && (time >= request.endSeconds || time < request.startSeconds)))
          restart();
        else player.playVideo();
      }
    },
    setActive(value) {
      if (active === value) return;
      active = value;
      if (!active) {
        cancelRepeat();
        stopBoundary();
        if (ready) {
          player.pauseVideo();
          report("paused");
        }
      } else if (ready && pendingStart) apply();
    },
  };
  window.onYouTubeIframeAPIReady = function () {
    if (!request) return;
    videoID = request.videoID;
    player = new YT.Player("player", {
      videoId: videoID,
      width: "100%",
      height: "100%",
      playerVars: { playsinline: 1, origin: window.location.origin, start: request.startSeconds },
      events: {
        onReady() {
          ready = true;
          report("tap-to-play");
          apply();
        },
        onStateChange(event) {
          if (!active) {
            if (event.data === 1) player.pauseVideo();
            return;
          }
          if (event.data === 1) {
            if (completed) {
              cancelRepeat();
              restart();
              return;
            }
            startBoundary();
            report("playing");
          } else if (event.data === 2) {
            stopBoundary();
            if (!completed) report("paused");
          } else if (event.data === 0) {
            if (bounded() && !awaitingSeek) finish();
            else {
              completed = true;
              stopBoundary();
              report("completed");
            }
          } else if (event.data === 5) report("tap-to-play");
        },
        onError(event) {
          cancelRepeat();
          stopBoundary();
          report("failed", event.data);
        },
        onAutoplayBlocked() {
          cancelRepeat();
          stopBoundary();
          report("tap-to-play");
        },
      },
    });
  };
  window.CLLYouTubeNetworkFailure = function () {
    networkFailed = true;
    cancelRepeat();
    stopBoundary();
    report("failed", -1);
  };
})();
