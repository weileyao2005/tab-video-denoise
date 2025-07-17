/**
 * @file post-processor.js
 * @desc 定义一个 AudioWorkletProcessor，用于在降噪后进行听感优化。
 * 该模块实现了舒适噪声生成（CNG）和平滑的淡入效果。
 */

class PostProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // 状态变量，用于追踪上一帧是否为语音
        this.isPreviousFrameSpeech = false;
        
        // --- 参数配置 ---
        // VAD 阈值：用于判断音频能量是否构成语音。
        // 由于输入来自 RNNoise，这个值可以设得很低。
        this.VAD_THRESHOLD = 0.001; 
        
        // 淡入效果的时长（以采样点计）。一个较短的淡入可以有效防止声音突然出现。
        // AudioWorkletProcessor 通常处理 128 个采样点的音频帧。
        this.FADE_IN_SAMPLES = 64; 

        // 舒适噪声的振幅，必须非常低才能听起来自然。
        this.NOISE_AMPLITUDE = 0.001;
    }

    /**
     * 计算音频块的均方根（RMS）能量。
     * @param {Float32Array} block - 音频数据块。
     * @returns {number} RMS 值。
     */
    _calculateRMS(block) {
        let sum = 0;
        for (let i = 0; i < block.length; i++) {
            sum += block[i] * block[i];
        }
        return Math.sqrt(sum / block.length);
    }

    /**
     * 生成一个数据块的舒适噪声（此处为白噪声）。
     * @param {Float32Array} channel - 需要填充噪声的输出通道。
     */
    _generateComfortNoise(channel) {
        for (let i = 0; i < channel.length; i++) {
            // 生成范围在 [-1, 1] 之间的随机数，并乘以设定的振幅
            channel[i] = (Math.random() * 2 - 1) * this.NOISE_AMPLITUDE;
        }
    }

    process(inputs, outputs) {
        // 我们处理单输入、单输出、单声道的情况。
        const input = inputs[0];
        const output = outputs[0];

        if (input.length === 0) {
            return true; // 没有数据需要处理
        }

        const inputChannel = input[0];
        const outputChannel = output[0];

        // 1. 进行语音活动检测
        const rms = this._calculateRMS(inputChannel);
        const isCurrentFrameSpeech = rms > this.VAD_THRESHOLD;

        if (isCurrentFrameSpeech) {
            // 2. 如果是语音帧
            outputChannel.set(inputChannel);

            // 如果上一帧是静音（SILENCE -> SPEECH 的过渡），则应用淡入效果
            if (!this.isPreviousFrameSpeech) {
                for (let i = 0; i < this.FADE_IN_SAMPLES && i < outputChannel.length; i++) {
                    const gain = i / this.FADE_IN_SAMPLES; // 增益从 0 线性增加到 1
                    outputChannel[i] *= gain;
                }
            }
            this.isPreviousFrameSpeech = true;

        } else {
            // 3. 如果是静音帧
            // 生成舒适噪声填充输出，而不是传递原始的静音
            this._generateComfortNoise(outputChannel);
            this.isPreviousFrameSpeech = false;
        }

        return true; // 保持处理器持续运行
    }
}

registerProcessor('post-processor', PostProcessor);