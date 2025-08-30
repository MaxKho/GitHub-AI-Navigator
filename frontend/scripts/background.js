/// <reference types="chrome"/>

const BASE_URL = ""

async function searchSummaries(query) {
  fetch(`${BASE_URL}/search/summaries/${query}`)
}

async function generateTree(treeJson) {
  const tree = JSON.parse(treeJson)
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "Test",
    title: "Test Context Menu",
    type: "normal",
    contexts: ['link', 'page']
  })
})
