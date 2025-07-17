/**
 * @file wavelet.js
 * @desc 提供离散小波变换（DWT）、阈值处理和逆变换（IDWT）的功能。
 * 使用 Haar 小波作为示例。
 * 【修改】使用 ES6 模块导出，以供 AudioWorklet 使用。
 */
export const Wavelet = {
    /**
     * 离散小波变换 (DWT)
     * @param {Float32Array} signal - 输入信号
     * @returns {Float32Array} - 变换后的系数
     */
    dwt: function(signal) {
        const n = signal.length;
        if (n < 2) return signal.slice();

        const half = n / 2;
        const result = new Float32Array(n);
        const approximation = result.subarray(0, half); // 近似分量 (低频)
        const detail = result.subarray(half);         // 细节分量 (高频)

        for (let i = 0; i < half; i++) {
            approximation[i] = (signal[2 * i] + signal[2 * i + 1]) / Math.sqrt(2);
            detail[i] = (signal[2 * i] - signal[2 * i + 1]) / Math.sqrt(2);
        }

        // 递归处理近似分量
        if (half > 1) {
            const transformedApproximation = this.dwt(approximation);
            result.set(transformedApproximation, 0);
        }
        
        return result;
    },

    /**
     * 软阈值处理函数
     * @param {Float32Array} coefficients - 小波系数
     * @param {number} threshold - 阈值
     * @returns {Float32Array} - 处理后的系数
     */
    softThreshold: function(coefficients, threshold) {
        return coefficients.map(c => {
            if (Math.abs(c) < threshold) {
                return 0;
            }
            return Math.sign(c) * (Math.abs(c) - threshold);
        });
    },

    /**
     * 逆离散小波变换 (IDWT)
     * @param {Float32Array} coefficients - 经过处理的小波系数
     * @returns {Float32Array} - 重建的信号
     */
    idwt: function(coefficients) {
        const n = coefficients.length;
        if (n < 2) return coefficients.slice();

        const half = n / 2;
        const result = new Float32Array(n);
        let approximation = coefficients.subarray(0, half);
        const detail = coefficients.subarray(half);

        // 如果近似分量也被变换过，先对其进行逆变换
        if (half > 1) {
            approximation = this.idwt(approximation);
        }

        for (let i = 0; i < half; i++) {
            result[2 * i] = (approximation[i] + detail[i]) / Math.sqrt(2);
            result[2 * i + 1] = (approximation[i] - detail[i]) / Math.sqrt(2);
        }

        return result;
    },
    
    /**
     * 核心降噪函数：变换 -> 阈值 -> 逆变换
     * @param {Float32Array} signal - 原始信号块
     * @param {number} threshold - 降噪阈值
     * @returns {Float32Array} - 降噪后的信号块
     */
    denoise: function(signal, threshold) {
        // 确保信号长度是2的幂，便于多级分解
        const N = Math.pow(2, Math.floor(Math.log2(signal.length)));
        if (N === 0) return signal;
        const truncatedSignal = signal.subarray(0, N);

        const coeffs = this.dwt(truncatedSignal);
        
        // 仅对细节分量（高频部分）进行阈值处理
        const half = N / 2;
        const detailCoeffs = coeffs.subarray(half);
        const thresholdedDetails = this.softThreshold(detailCoeffs, threshold);
        coeffs.set(thresholdedDetails, half);

        const denoisedSignal = this.idwt(coeffs);
        
        // 将未处理的部分补回
        const finalSignal = new Float32Array(signal.length);
        finalSignal.set(denoisedSignal, 0);
        finalSignal.set(signal.subarray(N), N);

        return finalSignal;
    }
};