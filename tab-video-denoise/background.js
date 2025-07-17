let panelWindowId = null;

chrome.action.onClicked.addListener((tab) => {
    if (panelWindowId !== null) {
        chrome.windows.get(panelWindowId, (win) => {
            if (chrome.runtime.lastError) {
                panelWindowId = null;
                createPanel(tab);
            } else {
                chrome.windows.update(panelWindowId, { focused: true });
            }
        });
    } else {
        createPanel(tab);
    }
});

/**
 * 【核心改动】重写 createPanel 函数
 * 1. 它现在是 async 异步函数。
 * 2. 它先获取 streamId，再带着 streamId 创建窗口。
 */
async function createPanel(tab) {
    // 首先，尝试获取 streamId
    let streamId = null;
    try {
        // 使用 Promise 包装 chrome.tabCapture.getMediaStreamId，以便使用 await
        streamId = await new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
                if (chrome.runtime.lastError) {
                    // 如果在这里就出错（例如，在受保护的页面上）
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(id);
                }
            });
        });
    } catch (error) {
        // 如果获取失败，提醒用户并终止操作
        console.error("在后台获取 streamId 失败:", error.message);
        return;
    }

    // 【核心改动】将 tab.id 和获取到的 streamId 都作为 URL 参数传递
    const panelUrl = chrome.runtime.getURL('control_panel.html') + `?tabId=${tab.id}&streamId=${streamId}`;

    // 使用新的 URL 创建窗口
    chrome.windows.create({
        url: panelUrl,
        type: 'popup',
        width: 380,
        height: 520
    }, (win) => {
        panelWindowId = win.id;
    });
}

chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === panelWindowId) {
        panelWindowId = null;
    }
});