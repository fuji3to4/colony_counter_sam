# colony_counter_sam

Github Pages: [https://fuji3to4.github.io/colony_counter_sam/](https://fuji3to4.github.io/colony_counter_sam/)

## E. coli Colony Counter

A browser-based tool for detecting and counting colonies in plate images. Choose lightweight image processing or SAM segmentation, then review and manually adjust the results. Images are processed locally and are not uploaded.

### Use

1. Serve this folder over HTTP, for example: `python -m http.server 8000`
2. Open `http://localhost:8000` in a browser.
3. Choose or take a plate photo, select a detection method, and run **Detect colonies**.
4. Review the count and add or remove detections as needed. Export the colony list or experiment record as CSV, or the annotated result as PNG.

The lightweight method works offline. SAM downloads its library and selected model from the internet on demand; the initial download may take time. Images remain in the browser.

## 大腸菌コロニーカウンタ

シャーレ画像のコロニーを検出・計数するブラウザアプリです。軽量な画像処理またはSAMによる領域分割を選べます。結果は手動で修正でき、画像はアップロードされません。

### 使い方

1. このフォルダをHTTPサーバーで公開します（例: `python -m http.server 8000`）。
2. ブラウザで `http://localhost:8000` を開きます。
3. シャーレの写真を選択または撮影し、検出方式を選んで「自動検出」を実行します。
4. 結果を確認し、必要に応じて追加・削除します。コロニー一覧・実験記録はCSV、結果画像はPNGで保存できます。

軽量方式はオフラインで動作します。SAM方式ではライブラリと選択したモデルをインターネットから取得するため、初回の読み込みに時間がかかる場合があります。画像はブラウザ内で処理されます。
