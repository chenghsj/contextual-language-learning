// Browser acceptance uses a deterministic player; real embedding is checked separately.
export const fakeYouTube = `
window.youtubeCalls=[];
window.YT={Player:class {
  constructor(frame,options){this.time=0;this.state=2;this.rate=1;window.syntheticPlayer=this;queueMicrotask(()=>options.events.onReady());}
  playVideo(){this.state=1;window.youtubeCalls.push(['play']);}
  pauseVideo(){this.state=2;window.youtubeCalls.push(['pause']);}
  seekTo(t){this.time=t;window.youtubeCalls.push(['seek',t]);}
  getCurrentTime(){return this.time;}
  getDuration(){return 600;}
  getPlayerState(){return this.state;}
  setPlaybackRate(rate){this.rate=rate;window.youtubeCalls.push(['rate',rate]);}
  destroy(){this.state=2;window.youtubeCalls.push(['destroy']);}
}};
window.onYouTubeIframeAPIReady?.();`;
export async function mockYouTube(page, embeds = []) {
  await page.route("https://www.youtube.com/iframe_api", route =>
    route.fulfill({ contentType: "application/javascript", body: fakeYouTube }),
  );
  await page.route("https://www.youtube-nocookie.com/embed/**", route => {
    embeds.push({ url: route.request().url(), referer: route.request().headers().referer });
    return route.fulfill({
      contentType: "text/html",
      body: "<html><body>Synthetic YouTube frame</body></html>",
    });
  });
}
