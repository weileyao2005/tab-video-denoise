/**
 * @copyright Copyright (c) 2025 tangseng
 * @author    tangseng <1579578612@qq.com>
 * @license   AGPL-3.0
 * @version   6.0
 * @file      control_panel.js
 * @desc      该脚本是音频控制面板的核心，用于捕获和处理标签页音频流，并提供实时降噪功能。 
 */
// --- 全局变量定义 ---
const masterSwitch = document.getElementById('master-switch');
const canvasTop = document.getElementById('canvas-top');
const canvasBottom = document.getElementById('canvas-bottom');
const ctxTop = canvasTop.getContext('2d');
const ctxBottom = canvasBottom.getContext('2d');

// 【关键】从URL参数中获取 tabId 和 streamId
const urlParams = new URLSearchParams(window.location.search);
const targetTabId = parseInt(urlParams.get('tabId'));
const streamId = urlParams.get('streamId');

// --- 音频处理相关变量 ---
let audioContext;
let sourceNode, processedSourceNode;
let analyserTop, analyserBottom;
let sourceStream, processor;
let animationFrameIdTop, animationFrameIdBottom;
let monoTrack = null;


// --- 初始化与事件监听 ---
document.addEventListener('DOMContentLoaded', initializeAudio);
masterSwitch.addEventListener('change', toggleProcessing);

/**
 * 核心初始化函数，面板打开时执行一次
 */
async function initializeAudio() {
    if (!targetTabId || !streamId) {
        alert("无效的标签页ID或音频流ID，无法启动。");
        return;
    }

    try {
        const constraints = {
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        };
        sourceStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        audioContext = new AudioContext();
        sourceNode = audioContext.createMediaStreamSource(sourceStream);

        // --- 立体声转单声道处理逻辑 ---
        const downmixer = audioContext.createGain();
        downmixer.channelCount = 1;
        downmixer.channelCountMode = "explicit";
        downmixer.channelInterpretation = "speakers";
        
        // 【最终修正】在创建 monoDestination 时，明确指定其为单声道
        const monoDestination = new MediaStreamAudioDestinationNode(audioContext, { channelCount: 1 });

        sourceNode.connect(downmixer);
        downmixer.connect(monoDestination);

        monoTrack = monoDestination.stream.getAudioTracks()[0];
        // --- 单声道处理结束 ---

        // 可视化部分设置
        analyserTop = audioContext.createAnalyser();
        analyserTop.fftSize = 2048;
        analyserBottom = audioContext.createAnalyser();
        analyserBottom.fftSize = 2048;

        sourceNode.connect(analyserTop);
        sourceNode.connect(analyserBottom);
        sourceNode.connect(audioContext.destination);

        // 启动绘图循环
        drawWaveform(analyserTop, ctxTop, (id) => animationFrameIdTop = id);
        drawWaveform(analyserBottom, ctxBottom, (id) => animationFrameIdBottom = id);

    } catch (error) {
        console.error("初始化失败:", error);
        alert("初始化音频捕获失败，请检查控制台。");
    }
}

/**
 * 切换降噪处理的核心函数
 */
async function toggleProcessing() {
    const isEnabled = masterSwitch.checked;

    if (isEnabled) {
        // --- 开启降噪 ---
        if (!monoTrack) {
            alert("单声道音轨尚未准备好！");
            masterSwitch.checked = false;
            return;
        }
        try {
            const assetsPath = chrome.runtime.getURL('/');
            processor = new Shiguredo.NoiseSuppressionProcessor(assetsPath);
            processedTrack = await processor.startProcessing(monoTrack);
            
            const processedStream = new MediaStream([processedTrack]);
            processedSourceNode = audioContext.createMediaStreamSource(processedStream);

            sourceNode.disconnect(analyserBottom);
            sourceNode.disconnect(audioContext.destination);
            
            processedSourceNode.connect(analyserBottom);
            processedSourceNode.connect(audioContext.destination);

        } catch (error) {
            console.error("开启降噪失败:", error);
            alert("降噪处理启动失败！");
            masterSwitch.checked = false;
        }
    } else {
        // --- 关闭降噪 ---
        if (processor) {
            processor.stopProcessing();
            processor = null;
        }
        if (processedSourceNode) {
            processedSourceNode.disconnect(analyserBottom);
            processedSourceNode.disconnect(audioContext.destination);
            processedSourceNode = null;
        }
        sourceNode.connect(analyserBottom);
        sourceNode.connect(audioContext.destination);
    }
}


/**
 * 绘制波形图的通用函数
 * @param {AnalyserNode} analyser
 * @param {CanvasRenderingContext2D} canvasCtx
 * @param {Function} setFrameId
 */
function drawWaveform(analyser, canvasCtx, setFrameId) {
    const frameId = requestAnimationFrame(() => drawWaveform(analyser, canvasCtx, setFrameId));
    setFrameId(frameId);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = '#001f3f';
    canvasCtx.fillRect(0, 0, canvasCtx.canvas.width, canvasCtx.canvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#39CCCC';

    canvasCtx.beginPath();

    const sliceWidth = canvasCtx.canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvasCtx.canvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    canvasCtx.lineTo(canvasCtx.canvas.width, canvasCtx.canvas.height / 2);
    canvasCtx.stroke();
}