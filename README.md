# AI Agent Invoices Demo

## demo


https://github.com/user-attachments/assets/d2a590aa-73c9-440f-99c3-f72755dc753c



## OpenAI APIからMCPサーバを呼ぶ

### 1) 依存関係をインストール

```bash
npm install
```

### 2) MCPサーバを起動

```bash
npm run start
```

### 3) 別ターミナルでOpenAI経由呼び出し

```bash
export OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
export MCP_SERVER_URL="http://localhost:8080/sse"
npm run demo:openai
```

`PROMPT` を指定すると質問を変更できます。

```bash
PROMPT="healthcheckを実行して" npm run demo:openai
```

## Chat UI から OpenAI API を呼ぶ

### 1) 環境変数を設定

```bash
export OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
# 重要: OpenAI から到達可能な公開URLを指定（localhost不可）
# 例: App Runner の /sse エンドポイント
export MCP_SERVER_URL="https://YOUR_APP_RUNNER_DOMAIN/sse"
# 任意（未設定時は gpt-5.2）
# export OPENAI_MODEL="gpt-5.2"
```

### 2) サーバを起動

```bash
npm run start
```

### 3) ブラウザで開く

```text
http://localhost:8080/
```

画面下の入力欄に質問を入れて送信すると、`/api/chat` 経由で OpenAI API を呼び出します。

`424 Error retrieving tool list` が出る場合は、`MCP_SERVER_URL` が `localhost` など外部非公開URLになっている可能性が高いです。

## 請求書PDF発行機能の環境変数

`issue_monthly_invoice_pdf` ツールを使う場合は、以下を設定してください。

```bash
export S3_BUCKET="your-invoice-bucket"
export AWS_REGION="ap-northeast-1"
export S3_PREFIX="invoices" # 任意: 末尾の / は省略可
# ローカルでAWS CLIのプロファイルを使う場合
# 例: aws s3api ... --profile mcp と同じ認証情報を使う
export AWS_PROFILE="mcp"
# 任意: credentialsファイルをデフォルト以外に置いている場合
# export AWS_SHARED_CREDENTIALS_FILE="$HOME/.aws/credentials"
# 任意: 日本語が文字化けする場合に日本語フォントを指定
# export PDF_FONT_PATH="/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
# macOSでの推奨例
export PDF_FONT_PATH="/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
```

- App Runner上で実行する場合は、サービスロールに `s3:PutObject` と `s3:GetObject` 権限が必要です。

- App Runner上で実行する場合は、**サービスロールではなく Instance role** に `s3:PutObject` と `s3:GetObject` 権限が必要です。

### App Runner で S3 アップロードを有効化する（必須）

1. IAMロールを作成し、信頼ポリシーに [docs/apprunner-instance-role-trust-policy.json](docs/apprunner-instance-role-trust-policy.json) を設定
2. そのロールに [docs/s3-invoice-access-policy-template.json](docs/s3-invoice-access-policy-template.json) を付与（`YOUR_BUCKET_NAME` を置換）
3. バケットが SSE-KMS の場合は [docs/s3-invoice-access-policy-kms-template.json](docs/s3-invoice-access-policy-kms-template.json) を使用
4. App Runner サービスの `Security` で `Instance role ARN` に上記ロールを設定
5. App Runner の環境変数で `S3_BUCKET` / `AWS_REGION` / `S3_PREFIX`（任意）を設定して再デプロイ

`Could not load credentials from any providers` が出る場合、ほぼこの `Instance role` 未設定または権限不足が原因です。

このリポジトリの現在設定（`S3_BUCKET=mcp-demo-1234`）向けの完成版は [docs/apprunner-instance-role-quick-setup.md](docs/apprunner-instance-role-quick-setup.md) を参照してください。

### App Runner での `PDF_FONT_PATH` 推奨値

App Runnerで日本語PDFを安定して出すために、`PDF_FONT_PATH` を明示設定してください。

- 推奨値: `/app/fonts/NotoSansJP-Regular.ttf`
- 代替値: `/app/fonts/NotoSansCJK-Regular.ttc`

手順:

1. リポジトリに `fonts/` ディレクトリを作り、日本語フォントファイルを配置（例: `fonts/NotoSansJP-Regular.ttf`）
2. App Runner の環境変数で `PDF_FONT_PATH=/app/fonts/NotoSansJP-Regular.ttf` を設定
3. 再デプロイ

※ アプリ側は `S3_BUCKET` と `AWS_REGION` も必要です。

## 請求書作成確認用エンドポイント

`POST /api/invoices/generate` は、指定した会社・請求月のPDFを生成してそのまま返します（S3不要）。

```bash
curl -sS -X POST "http://localhost:8080/api/invoices/generate" \
	-H "Content-Type: application/json" \
	-d '{"company_name":"株式会社テックリンク","billing_month":"2026-02"}' \
	--output invoice.pdf
```

生成後、`invoice.pdf` を開いて内容を確認できます。

## S3アップロード確認用エンドポイント

`POST /api/invoices/upload-to-s3` は、請求書PDFを生成してS3へアップロードし、`s3Key` / `objectUrl` / `signedUrl` を返します。

```bash
curl -sS -X POST "http://localhost:8080/api/invoices/upload-to-s3" \
	-H "Content-Type: application/json" \
	-d '{"company_name":"株式会社テックリンク","billing_month":"2026-02"}'
```

