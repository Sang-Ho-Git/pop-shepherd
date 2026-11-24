// 압축하지 않은 웹 빌드 (성능 프로파일에서 함수 이름이 보이게): node tools/build-web-dev.mjs <출력 파일>
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const outFile = process.argv[2] ?? "dist/pop-shepherd-dev.html";
const r = await build({ entryPoints: ["web/main.ts"], bundle: true, format: "iife", minify: false, target: "es2022", write: false, charset: "utf8" });
const js = r.outputFiles[0].text.replaceAll("</script", "<\\/script");
writeFileSync(outFile, readFileSync("web/index.html", "utf8").replace("<!--BUNDLE-->", () => `<script>${js}</script>`));
console.log(outFile);
