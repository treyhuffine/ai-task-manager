/** Immutable model allowlist. Never resolve a mutable Hugging Face branch at runtime. */
export const PARAKEET_REVISION = '8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce';
export const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3';
export const PARAKEET_FILES = [
  { name: 'config.json', size: 97, sha256: '666903c76b9798caf2c210afd4f6cd60b08a8dbf9800ec8d7a3bc0d2148ac466' },
  { name: 'vocab.txt', size: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
  { name: 'encoder-model.int8.onnx', size: 652183999, sha256: '6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09' },
  { name: 'decoder_joint-model.int8.onnx', size: 18202004, sha256: 'eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70' },
  { name: 'nemo128.onnx', size: 139764, sha256: 'a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f' },
] as const;
export const PARAKEET_BYTES = PARAKEET_FILES.reduce((sum, file) => sum + file.size, 0);
export interface ModelFile { name: string; size: number; sha256: string }
export const modelUrl = (name: string) => `https://huggingface.co/istupakov/${PARAKEET_MODEL}-onnx/resolve/${PARAKEET_REVISION}/${name}`;
