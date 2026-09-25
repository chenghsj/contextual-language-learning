void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Chrome without Side Panel support will report an error when the extension loads.
});
