// 웹 빌드: web/main.ts를 하나의 스크립트로 묶어 web/index.html에 넣는다 → dist/pop-shepherd.html
//   npm run build:web
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const out = await build({
  entryPoints: ["web/main.ts"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2022",
  write: false,
  charset: "utf8",
  legalComments: "none",
});
const js = out.outputFiles[0].text.replaceAll("</script", "<\\/script");
const html = readFileSync("web/index.html", "utf8").replace("<!--BUNDLE-->", () => `<script>${js}</script>`);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/pop-shepherd.html", html);
console.log(`dist/pop-shepherd.html ${(html.length / 1024).toFixed(0)}KB`);
