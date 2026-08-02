window.__APP_CONFIG__ = {
  localTranslation: {
    enabled: true,
    model: "Xenova/opus-mt-en-es",
    device: "wasm",
    dtype: "fp32",
    maxNewTokens: 96,
  },
  ocr: {
    enabled: true,
    // GLM-OCR needs WebGPU. q4f16 is about 630 MB; "q4" is larger but does not
    // require fp16 support, and "fp16"/"fp32" are desktop-only at 2 GB or more.
    model: "onnx-community/GLM-OCR-ONNX",
    device: "webgpu",
    dtype: "q4f16",
    maxNewTokens: 1024,
    maxImageSide: 1400,
  },
};
