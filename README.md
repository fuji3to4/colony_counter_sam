# colony_counter_sam

Github Pages: [https://fuji3to4.github.io/colony_counter_sam/](https://fuji3to4.github.io/colony_counter_sam/)

## E. coli Colony Counter

A browser-based tool for detecting and counting colonies in plate images. Choose lightweight image processing or SAM segmentation, then review and manually adjust the results. Images are processed locally and are not uploaded.

### Features

- Two detection methods: lightweight image processing, or AI segmentation with SlimSAM / SAM 3.
- Use a photo, camera capture, or drag-and-drop; works on desktop and mobile.
- Adjust the plate area and detection settings, then add missed colonies or remove false detections.
- Export colony details and experiment records as CSV, or save an annotated result image as PNG.
- Japanese and English interface. Images stay in your browser; only SAM requires an internet connection to load its library and model.

### Use

1. Serve this folder over HTTP, for example: `python -m http.server 8000`
2. Open `http://localhost:8000` in a browser.
3. Choose or take a plate photo, select a detection method, and run **Detect colonies**.
4. Review the count and add or remove detections as needed. Export the colony list or experiment record as CSV, or the annotated result as PNG.

The lightweight method works offline. SAM downloads its library and selected model from the internet on demand; the initial download may take time. Images remain in the browser.

## 大腸菌コロニーカウンタ

シャーレ画像のコロニーを検出・計数するブラウザアプリです。軽量な画像処理またはSAMによる領域分割を選べます。結果は手動で修正でき、画像はアップロードされません。

### 主な特徴

- 軽量な画像処理と、SlimSAM / SAM 3 によるAI領域分割の2方式。
- 写真の選択、カメラ撮影、ドラッグ＆ドロップに対応。PC・スマートフォンで使えます。
- シャーレ範囲や検出設定を調整でき、見落としの追加や誤検出の削除も可能です。
- コロニー一覧・実験記録をCSV、注釈付きの結果画像をPNGで保存できます。
- 日本語・英語を切り替え可能です。画像はブラウザ内で処理し、SAMの利用時のみライブラリとモデルの取得にインターネットを使います。

### 使い方

1. このフォルダをHTTPサーバーで公開します（例: `python -m http.server 8000`）。
2. ブラウザで `http://localhost:8000` を開きます。
3. シャーレの写真を選択または撮影し、検出方式を選んで「自動検出」を実行します。
4. 結果を確認し、必要に応じて追加・削除します。コロニー一覧・実験記録はCSV、結果画像はPNGで保存できます。

軽量方式はオフラインで動作します。SAM方式ではライブラリと選択したモデルをインターネットから取得するため、初回の読み込みに時間がかかる場合があります。画像はブラウザ内で処理されます。

## License

Licensed under the MIT License. See [LICENSE](LICENSE).

