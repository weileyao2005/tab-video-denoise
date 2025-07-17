/**
 * @copyright Copyright (c) 2025 tangseng
 * @author    tangseng <1579578612@qq.com>
 * @license   AGPL-3.0
 * @version   6.0
 * @file      control_panel.js
 * @desc      该脚本是音频控制面板的核心，用于捕获和处理标签页音频流，并提供实时降噪与空间音频功能。
 */
// --- 全局变量定义 ---
const masterSwitch = document.getElementById('master-switch');
const combinedCanvas = document.getElementById('combined-canvas');
const ctxCombined = combinedCanvas.getContext('2d');

const urlParams = new URLSearchParams(window.location.search);
const targetTabId = parseInt(urlParams.get('tabId'));
const streamId = urlParams.get('streamId');

// --- 新增：空间音频UI元素 ---
const azimuthSlider = document.getElementById('azimuth-slider');
const azimuthValue = document.getElementById('azimuth-value');
const pannerBall = document.getElementById('panner-ball');
const pannerTrack = document.querySelector('.panner-track');
const listenerIndicator = document.querySelector('.listener-indicator');

// --- 音频处理相关变量 ---
let audioContext;
let sourceNode;
let analyserTop, analyserBottom;
let sourceStream, processor;
let animationFrameIdCombined;
let monoTrack = null;
let waveletNode, waveletDestination;
let waveletProcessedTrack;
let rnnoiseSourceNode;
let postProcessorNode;
let pannerNode;
let currentAzimuth = 0;
let isDragging = false;
let pannerTrackRect;
const MIN_ANGLE_STEP = 15;

// --- 初始化与事件监听 ---
document.addEventListener('DOMContentLoaded', initializeAudio);
masterSwitch.addEventListener('change', toggleProcessing);

// 【新增】为方位角滑块和可视化添加事件监听
azimuthSlider.addEventListener('input', updatePannerPositionFromSlider);
pannerBall.addEventListener('mousedown', startDrag);
document.addEventListener('mouseup', endDrag);
document.addEventListener('mousemove', dragPannerBall);

/**
 * 核心初始化函数，面板打开时执行一次
 */
async function initializeAudio() {
    if (!targetTabId || !streamId) {
        // 在DOM中显示错误信息，而不是使用alert
        document.body.innerHTML = `<div style="padding: 20px; text-align: center; font-size: 16px; color: #d9534f;">错误：无效的标签页ID或音频流ID，无法启动。</div>`;
        return;
    }

    try {
        const constraints = {
            audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        };
        sourceStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // 如果成功获取流，继续执行初始化
        audioContext = new AudioContext();

        try {
            await audioContext.audioWorklet.addModule('wavelet-processor.js');
            await audioContext.audioWorklet.addModule('post-processor.js');
        } catch (e) {
            console.error('加载 AudioWorklet 模块失败:', e);
            document.body.innerHTML = `<div style="padding: 20px; text-align: center; font-size: 16px; color: #d9534f;">错误：无法加载核心音频处理模块。请检查开发者控制台。</div>`;
            return;
        }

        sourceNode = audioContext.createMediaStreamSource(sourceStream);

        const downmixer = audioContext.createGain();
        downmixer.channelCount = 1;
        downmixer.channelCountMode = "explicit";
        downmixer.channelInterpretation = "speakers";
        const monoDestination = new MediaStreamAudioDestinationNode(audioContext, { channelCount: 1 });
        sourceNode.connect(downmixer);
        downmixer.connect(monoDestination);
        monoTrack = monoDestination.stream.getAudioTracks()[0];

        const monoSourceNode = audioContext.createMediaStreamSource(monoDestination.stream);
        waveletNode = new AudioWorkletNode(audioContext, 'wavelet-denoise-processor');
        waveletDestination = new MediaStreamAudioDestinationNode(audioContext, { channelCount: 1 });
        monoSourceNode.connect(waveletNode);
        waveletNode.connect(waveletDestination);
        waveletProcessedTrack = waveletDestination.stream.getAudioTracks()[0];

        analyserTop = audioContext.createAnalyser();
        analyserTop.fftSize = 2048;
        analyserBottom = audioContext.createAnalyser();
        analyserBottom.fftSize = 2048;

        sourceNode.connect(analyserTop);
        sourceNode.connect(analyserBottom);
        sourceNode.connect(audioContext.destination);

        drawCombinedWaveform();
        updatePannerBallPosition(currentAzimuth);

    } catch (error) {
        console.error("初始化失败:", error.name, error.message, error);

        let userMessage = "音频捕获失败。";
        switch (error.name) {
            case 'NotFoundError':
                userMessage = "无法找到目标标签页的音频源。请确认该标签页未关闭、未刷新，并且正在播放音频。";
                break;
            case 'NotReadableError':
                userMessage = "无法读取音频流，可能是由于浏览器或系统错误。请尝试刷新目标页面或重启浏览器。";
                break;
            case 'NotAllowedError':
                userMessage = "获取标签页音频的权限被拒绝。请检查浏览器扩展权限设置。";
                break;
            case 'AbortError': // <--- 修改这里
                 userMessage = "音频捕获已中止。请尝试刷新目标页面或重新开关本插件浏览器。";
                 break;
            default:
                userMessage = "发生未知错误，无法捕获音频。请检查开发者控制台获取详细信息。";
        }
        
        document.body.innerHTML = `<div style="padding: 20px; text-align: center; font-size: 16px; color: #d9534f;">${userMessage}</div>`;
    }
}

document.getElementById('wavelet-threshold').addEventListener('input', (event) => {
    if (waveletNode) {
        const newThreshold = parseFloat(event.target.value);
        waveletNode.port.postMessage({ threshold: newThreshold });
    }
});

/**
 * 切换降噪处理的核心函数
 */
async function toggleProcessing() {
    const isEnabled = masterSwitch.checked;

    if (isEnabled) {
        document.body.classList.add('theme-on');
    } else {
        document.body.classList.remove('theme-on');
    }
    if (isEnabled) {
        if (!waveletProcessedTrack) {
            alert("小波预处理音轨尚未准备好！");
            masterSwitch.checked = false;
            return;
        }
        try {
            const assetsPath = chrome.runtime.getURL('/');
            processor = new Shiguredo.NoiseSuppressionProcessor(assetsPath);
            const processedTrack = await processor.startProcessing(waveletProcessedTrack);
            const processedStream = new MediaStream([processedTrack]);
            rnnoiseSourceNode = audioContext.createMediaStreamSource(processedStream);
            postProcessorNode = new AudioWorkletNode(audioContext, 'post-processor');
            pannerNode = new PannerNode(audioContext, {
                panningModel: 'equalpower',
                distanceModel: 'linear',
                positionX: 0,
                positionY: 0,
                positionZ: -5,
                orientationX: 0,
                orientationY: 1,
                orientationZ: 0,
            });
            sourceNode.disconnect(analyserBottom);
            sourceNode.disconnect(audioContext.destination);
            rnnoiseSourceNode.connect(postProcessorNode);
            postProcessorNode.connect(pannerNode);
            pannerNode.connect(analyserBottom);
            pannerNode.connect(audioContext.destination);
            updatePannerNodePosition(currentAzimuth);
        } catch (error) {
            console.error("开启降噪失败:", error);
            alert("降噪处理启动失败！");
            masterSwitch.checked = false;
        }
    } else {
        if (processor) {
            processor.stopProcessing();
            processor = null;
        }
        if (rnnoiseSourceNode) rnnoiseSourceNode.disconnect();
        if (postProcessorNode) postProcessorNode.disconnect();
        if (pannerNode) pannerNode.disconnect();
        rnnoiseSourceNode = null;
        postProcessorNode = null;
        pannerNode = null;
        sourceNode.connect(analyserBottom);
        sourceNode.connect(audioContext.destination);
    }
}

function updatePannerNodePosition(azimuthDegrees) {
    const azimuthRadians = azimuthDegrees * Math.PI / 180;
    const x = 5 * Math.sin(azimuthRadians);
    const z = -5 * Math.cos(azimuthRadians);

    if (pannerNode) {
        pannerNode.positionX.setTargetAtTime(x, audioContext.currentTime, 0.01);
        pannerNode.positionY.setTargetAtTime(0, audioContext.currentTime, 0.01);
        pannerNode.positionZ.setTargetAtTime(z, audioContext.currentTime, 0.01);
    }
}

function updatePannerPositionFromSlider() {
    currentAzimuth = parseInt(azimuthSlider.value);
    azimuthValue.textContent = `${currentAzimuth}°`;
    updatePannerNodePosition(currentAzimuth);
    updatePannerBallPosition(currentAzimuth);
}

function updatePannerBallPosition(azimuthDegrees) {
    const radius = pannerTrack.offsetWidth / 2;
    const centerX = pannerTrack.offsetLeft + radius;
    const centerY = pannerTrack.offsetTop + radius;
    const angleRadians = azimuthDegrees * Math.PI / 180;
    const ballX = centerX + radius * Math.sin(angleRadians);
    const ballY = centerY - radius * Math.cos(angleRadians);

    pannerBall.style.left = `${ballX}px`;
    pannerBall.style.top = `${ballY}px`;
}

function startDrag(e) {
    isDragging = true;
    pannerBall.classList.add('dragging');
    pannerTrackRect = pannerTrack.getBoundingClientRect();
}

function endDrag() {
    isDragging = false;
    pannerBall.classList.remove('dragging');
}

function dragPannerBall(e) {
    if (!isDragging) return;

    const rect = pannerTrackRect;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let deltaX = e.clientX - centerX;
    let deltaY = e.clientY - centerY;
    let angleRadians = Math.atan2(deltaX, -deltaY);

    let angleDegrees = angleRadians * 180 / Math.PI;
    if (angleDegrees < 0) angleDegrees += 360;

    const snappedAngle = Math.round(angleDegrees / MIN_ANGLE_STEP) * MIN_ANGLE_STEP;

    if (snappedAngle !== currentAzimuth) {
        currentAzimuth = snappedAngle;
        azimuthSlider.value = currentAzimuth;
        azimuthValue.textContent = `${currentAzimuth}°`;
        updatePannerNodePosition(currentAzimuth);
        updatePannerBallPosition(currentAzimuth);
    }
}

/**
 * 【修改】绘制合并后的波形图，采用辉光效果并从CSS变量读取颜色。
 */
function drawCombinedWaveform() {
    animationFrameIdCombined = requestAnimationFrame(drawCombinedWaveform);

    if (!analyserTop || !analyserBottom || !ctxCombined) {
        cancelAnimationFrame(animationFrameIdCombined);
        return;
    }

    const bufferLength = analyserTop.frequencyBinCount;
    const dataArrayTop = new Uint8Array(bufferLength);
    const dataArrayBottom = new Uint8Array(bufferLength);
    analyserTop.getByteTimeDomainData(dataArrayTop);
    analyserBottom.getByteTimeDomainData(dataArrayBottom);

    // 【修改】使用 clearRect 清空画布以实现透明背景
    ctxCombined.clearRect(0, 0, ctxCombined.canvas.width, ctxCombined.canvas.height);

    // 【新增】从 CSS 变量动态获取颜色
    const style = getComputedStyle(document.body);
    const isEnabled = masterSwitch.checked;
    const originalColor = style.getPropertyValue('--waveform-original-color').trim();
    const processedColor = style.getPropertyValue('--waveform-processed-color').trim();
    
    ctxCombined.lineWidth = 2;
    // 【新增】仅在开启主题时应用辉光效果
    if (isEnabled) {
        ctxCombined.shadowBlur = 8;
    }

    // 绘制原始信号 (输入波形)
    ctxCombined.strokeStyle = originalColor;
    if (isEnabled) ctxCombined.shadowColor = originalColor;
    ctxCombined.beginPath();
    let sliceWidth = ctxCombined.canvas.width * 1.0 / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArrayTop[i] / 128.0;
        const y = (v - 1.0) * (ctxCombined.canvas.height / 4);
        if (i === 0) {
            ctxCombined.moveTo(x, ctxCombined.canvas.height / 4 + y);
        } else {
            ctxCombined.lineTo(x, ctxCombined.canvas.height / 4 + y);
        }
        x += sliceWidth;
    }
    ctxCombined.stroke();

    // 绘制处理后的信号 (输出波形)
    ctxCombined.strokeStyle = processedColor;
    if (isEnabled) ctxCombined.shadowColor = processedColor;
    ctxCombined.beginPath();
    x = 0;
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArrayBottom[i] / 128.0;
        const y = (v - 1.0) * (ctxCombined.canvas.height / 4);
        if (i === 0) {
            ctxCombined.moveTo(x, ctxCombined.canvas.height * 3 / 4 + y);
        } else {
            ctxCombined.lineTo(x, ctxCombined.canvas.height * 3 / 4 + y);
        }
        x += sliceWidth;
    }
    ctxCombined.stroke();

    // 【新增】重置辉光效果，避免影响其他可能的绘制操作
    ctxCombined.shadowBlur = 0;
    ctxCombined.shadowColor = 'transparent';
}