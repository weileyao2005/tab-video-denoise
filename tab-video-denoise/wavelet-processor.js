/**
 * @file wavelet-processor.js
 * @desc 定义一个 AudioWorkletProcessor，用于实时小波降噪。
 */
// 【修改】使用 ES6 import 语句，而不是 importScripts
import { Wavelet } from './wavelet.js';

class WaveletDenoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.isEnabled = true; // 默认开启
        this.threshold = 0.1;  // 默认阈值，可以后续通过消息调整
        this.port.onmessage = (event) => {
            if (event.data.hasOwnProperty('isEnabled')) {
                this.isEnabled = event.data.isEnabled;
            }
            if (event.data.hasOwnProperty('threshold')) {
                this.threshold = event.data.threshold;
            }
        };
    }

    /**
     * 核心处理函数，由音频引擎在每个音频块上调用
     * @param {Float32Array[][]} inputs - 输入音频数据
     * @param {Float32Array[][]} outputs - 输出音频数据
     * @param {Object} parameters - 其他参数
     * @returns {boolean} - 返回 true 以保持处理器活动
     */
    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        
        // 我们假设输入和输出都是单声道
        if (input.length > 0) {
            const inputChannel = input[0];
            const outputChannel = output[0];

            if (this.isEnabled) {
                // 应用小波降噪
                const denoisedSignal = Wavelet.denoise(inputChannel, this.threshold);
                outputChannel.set(denoisedSignal);
            } else {
                // 如果禁用，直接透传
                outputChannel.set(inputChannel);
            }
        }
        
        return true;
    }
}

registerProcessor('wavelet-denoise-processor', WaveletDenoiseProcessor);