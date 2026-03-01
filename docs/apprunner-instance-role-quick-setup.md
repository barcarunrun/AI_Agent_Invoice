# App Runner Instance Role クイック設定

## 使うファイル

- 信頼ポリシー: `docs/apprunner-instance-role-trust-policy.json`
- S3権限ポリシー（この環境向け）: `docs/s3-invoice-access-policy-mcp-demo-1234.json`
- （必要な場合のみ）S3バケットポリシー: `docs/s3-bucket-policy-for-apprunner-role-template.json`

## 貼り付け先の対応（ここを間違えるとエラーになります）

- `apprunner-instance-role-trust-policy.json` は **IAMロールの信頼ポリシー（Trust relationships）** に貼る
- `s3-invoice-access-policy-mcp-demo-1234.json` は **IAMロールの権限ポリシー（Permissions）** に貼る
- `s3-bucket-policy-for-apprunner-role-template.json` は **S3バケットポリシー** に貼る（必要時のみ）

## 手順（AWSコンソール）

1. IAM で新しいロールを作成
2. 信頼ポリシーに `docs/apprunner-instance-role-trust-policy.json` の内容を設定
3. インラインポリシーまたはマネージドポリシーとして `docs/s3-invoice-access-policy-mcp-demo-1234.json` を付与
4. App Runner サービスの `Security` で `Instance role ARN` にこのロールを設定
5. App Runner 環境変数を確認
   - `S3_BUCKET=mcp-demo-1234`
   - `AWS_REGION=ap-northeast-1`
   - `S3_PREFIX=invoices`（任意）

## 補足

- バケットのデフォルト暗号化が SSE-KMS の場合は、KMS権限付きテンプレート `docs/s3-invoice-access-policy-kms-template.json` を使って KMS ARN を埋めてください。
- もし貼り付け時にエラーが出る場合、エラーメッセージ全文（1行でOK）を共有してください。貼り付け先に合わせてその場で修正版を作れます。
