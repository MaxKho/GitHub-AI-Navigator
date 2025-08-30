/// <reference types="chrome"/>

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({
      url: 'onboarding.html'
    })
  }

  chrome.contextMenus.create({
    id: "open-popup",
    title: "Open Github AI Navigator",
    contexts: ["browser_action"]
  });

  chrome.contextMenus.onClicked.addListener(() => {
    chrome.action.openPopup();
  });
})
