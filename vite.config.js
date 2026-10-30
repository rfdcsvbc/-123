import { defineConfig } from 'vite';
import { readFileSync, createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// Ship the installed model and WASM with the page: camera startup works offline.
const require = createRequire(import.meta.url);
const modelRoot = path.dirname(require.resolve('@mediapipe/hands'));
const modelFiles = ['hand_landmark_lite.tflite', 'hand_landmark_full.tflite',
  'hands_solution_packed_assets_loader.js', 'hands_solution_packed_assets.data',
  'hands_solution_simd_wasm_bin.data', 'hands_solution_simd_wasm_bin.js',
  'hands_solution_simd_wasm_bin.wasm', 'hands_solution_wasm_bin.js',
  'hands_solution_wasm_bin.wasm', 'hands.binarypb'];

function localHandModels() {
  return {
    name: 'local-hand-models',
    configureServer(server) {
      server.middlewares.use('/mediapipe', (req, res, next) => {
        const name = req.url.split('?')[0].replace(/^\//, '');
        if (!modelFiles.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript'
          : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(path.join(modelRoot, name)).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
      });
    },
    generateBundle() {
      modelFiles.forEach((name) => this.emitFile({ type: 'asset',
        fileName: `mediapipe/${name}`, source: readFileSync(path.join(modelRoot, name)) }));
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [localHandModels()],
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/gsap')) return 'motion';
          return undefined;
        }
      }
    }
  }
});
