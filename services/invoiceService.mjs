import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ServiceError } from "./service-error.mjs";

const monthlyInvoiceTable = [
    
    {
        companyName: "株式会社サンプル商事",
        billingMonth: "2026-01",
        amount: "220万円",
        details: [
            { item: "API利用料", amount: "170万円" },
            { item: "保守費", amount: "50万円" },
        ],
    },
    {
        companyName: "株式会社サンプル商事",
        billingMonth: "2026-02",
        amount: "205万円",
        details: [
            { item: "API利用料", amount: "160万円" },
            { item: "保守費", amount: "45万円" },
        ],
    },
    {
        companyName: "株式会社テックリンク",
        billingMonth: "2026-01",
        amount: "98万円",
        details: [
            { item: "プラットフォーム利用料", amount: "70万円" },
            { item: "追加サポート", amount: "28万円" },
        ],
    },
    {
        companyName: "株式会社テックリンク",
        billingMonth: "2026-02",
        amount: "104万円",
        details: [
            { item: "プラットフォーム利用料", amount: "74万円" },
            { item: "追加サポート", amount: "30万円" },
        ],
    },
    {
        companyName: "株式会社ブルースカイ",
        billingMonth: "2026-01",
        amount: "176万円",
        details: [
            { item: "SaaS利用料", amount: "130万円" },
            { item: "導入支援", amount: "46万円" },
        ],
    },
    {
        companyName: "株式会社ブルースカイ",
        billingMonth: "2026-02",
        amount: "183万円",
        details: [
            { item: "SaaS利用料", amount: "136万円" },
            { item: "導入支援", amount: "47万円" },
        ],
    },
];

export const invoiceRequestSchema = z.object({
    company_name: z.string().min(1),
    billing_month: z.string().regex(/^\d{4}-\d{2}$/),
});

function normalizeS3Prefix(prefix) {
    if (typeof prefix !== "string") {
        return "";
    }

    const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
    return trimmed ? `${trimmed}/` : "";
}

function encodeS3KeyForUrl(s3Key) {
    return s3Key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function getS3RuntimeConfig() {
    const s3Bucket = process.env.S3_BUCKET || "mcp-demo-1234";
    const awsRegion = process.env.AWS_REGION || "ap-northeast-1";
    const awsProfile = process.env.AWS_PROFILE;
    const awsSharedCredentialsFile = process.env.AWS_SHARED_CREDENTIALS_FILE;

    return { s3Bucket, awsRegion, awsProfile, awsSharedCredentialsFile };
}

function createS3ClientFromRuntimeConfig({ awsRegion, awsProfile, awsSharedCredentialsFile }) {
    return new S3Client({
        region: awsRegion,
        ...(awsProfile
            ? {
                  credentials: fromIni({
                      profile: awsProfile,
                      ...(awsSharedCredentialsFile
                          ? { filepath: awsSharedCredentialsFile }
                          : {}),
                  }),
              }
            : {}),
    });
}

function resolveConfiguredFontPathCandidates(configuredPath) {
    if (typeof configuredPath !== "string") {
        return [];
    }

    const trimmed = configuredPath.trim();
    if (!trimmed) {
        return [];
    }

    const unquoted = trimmed.replace(/^['\"]|['\"]$/g, "");
    const unescapedSpaces = unquoted.replace(/\\ /g, " ");

    return [...new Set([trimmed, unquoted, unescapedSpaces].filter(Boolean))];
}

export function normalizeCompanyName(companyName) {
    return companyName
        .replaceAll(/[\s　]/g, "")
        .replace(/^株式会社/, "")
        .toLowerCase();
}

function resolvePdfFontPath() {
    const configuredPath = process.env.PDF_FONT_PATH;
    const configuredCandidates = resolveConfiguredFontPathCandidates(configuredPath);

    for (const candidate of configuredCandidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    const candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/app/fonts/NotoSansCJK-Regular.ttc",
        "/app/fonts/NotoSansJP-Regular.ttf",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ];

    return candidates.find((fontPath) => existsSync(fontPath)) ?? null;
}

const pdfFontPath = resolvePdfFontPath();

export function findMonthlyInvoice(companyName, billingMonth) {
    const normalizedInput = normalizeCompanyName(companyName);

    return monthlyInvoiceTable.find((item) => {
        const normalizedCandidate = normalizeCompanyName(item.companyName);
        const isSameCompany =
            normalizedCandidate === normalizedInput ||
            normalizedCandidate.includes(normalizedInput) ||
            normalizedInput.includes(normalizedCandidate);

        return isSameCompany && item.billingMonth === billingMonth;
    });
}

export function getAvailableBillingMonths(companyName) {
    return [
        ...new Set(
            monthlyInvoiceTable
                .filter(
                    (item) => normalizeCompanyName(item.companyName) === normalizeCompanyName(companyName)
                )
                .map((item) => item.billingMonth)
        ),
    ];
}

function resolveInvoiceOrThrow(companyName, billingMonth) {
    const invoice = findMonthlyInvoice(companyName, billingMonth);

    if (!invoice) {
        throw new ServiceError(
            404,
            `会社名「${companyName}」の${billingMonth}の請求データは見つかりませんでした。`
        );
    }

    return invoice;
}

function buildInvoicePdfBuffer(invoice) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 50 });
        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        if (!pdfFontPath) {
            reject(
                new Error(
                    "日本語フォントが見つかりません。PDF_FONT_PATH に日本語対応フォント（.ttf/.ttc）を設定してください。"
                )
            );
            return;
        }

        doc.font(pdfFontPath);

        const issuedAt = new Date().toISOString().slice(0, 10);

        doc.fontSize(20).text("請求書", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`発行日: ${issuedAt}`);
        doc.text(`請求先: ${invoice.companyName}`);
        doc.text(`対象月: ${invoice.billingMonth}`);
        doc.moveDown();

        doc.fontSize(14).text("明細");
        doc.moveDown(0.5);
        invoice.details.forEach((detail, index) => {
            doc.fontSize(12).text(`${index + 1}. ${detail.item}  ${detail.amount}`);
        });

        doc.moveDown();
        doc.fontSize(14).text(`合計請求額: ${invoice.amount}`);
        doc.end();
    });
}

async function uploadInvoicePdfToS3(pdfBuffer, invoice) {
    const { s3Bucket, awsRegion, awsProfile, awsSharedCredentialsFile } = getS3RuntimeConfig();
    const s3Prefix = normalizeS3Prefix(process.env.S3_PREFIX || "invoices");

    if (!s3Bucket) {
        throw new Error("S3_BUCKET が設定されていません。");
    }

    const s3Client = createS3ClientFromRuntimeConfig({
        awsRegion,
        awsProfile,
        awsSharedCredentialsFile,
    });
    const companyForKey = normalizeCompanyName(invoice.companyName);
            const s3Key = `${s3Prefix}${companyForKey}/${invoice.billingMonth}/invoice-${randomUUID()}.pdf`;

    await s3Client.send(
        new PutObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
            Body: pdfBuffer,
            ContentType: "application/pdf",
        })
    );

    const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
            Bucket: s3Bucket,
            Key: s3Key,
        }),
        { expiresIn: 60 * 60 * 24 * 7 }
    );

    const objectUrl = `https://${s3Bucket}.s3.${awsRegion}.amazonaws.com/${encodeS3KeyForUrl(s3Key)}`;
    const downloadPath = `/api/invoices/download?key=${encodeURIComponent(s3Key)}`;

    return { s3Key, objectUrl, signedUrl, downloadPath };
}

export async function getSignedInvoiceDownloadUrlByS3Key(s3Key) {
    if (typeof s3Key !== "string" || !s3Key.trim()) {
        throw new ServiceError(400, "key は必須です。");
    }

    const normalizedKey = decodeURIComponent(s3Key.trim());
    const { s3Bucket, awsRegion, awsProfile, awsSharedCredentialsFile } = getS3RuntimeConfig();

    const s3Client = createS3ClientFromRuntimeConfig({
        awsRegion,
        awsProfile,
        awsSharedCredentialsFile,
    });

    const signedUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
            Bucket: s3Bucket,
            Key: normalizedKey,
        }),
        { expiresIn: 60 * 60 * 24 * 7 }
    );

    return signedUrl;
}

export async function generateInvoicePdf(companyName, billingMonth) {
    const invoice = resolveInvoiceOrThrow(companyName, billingMonth);

    try {
        const pdfBuffer = await buildInvoicePdfBuffer(invoice);
        return { invoice, pdfBuffer };
    } catch (error) {
        throw new ServiceError(
            500,
            `請求書PDFの生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function uploadInvoicePdf(companyName, billingMonth) {
    const invoice = resolveInvoiceOrThrow(companyName, billingMonth);

    try {
        const pdfBuffer = await buildInvoicePdfBuffer(invoice);
        const uploadResult = await uploadInvoicePdfToS3(pdfBuffer, invoice);
        return { invoice, uploadResult };
    } catch (error) {
        if (
            error instanceof Error &&
            /Could not load credentials from any providers/i.test(error.message)
        ) {
            throw new ServiceError(
                500,
                "AWS認証情報を取得できませんでした。App Runner では Instance role を設定し、対象バケットへの s3:PutObject/s3:GetObject 権限を付与してください。"
            );
        }

        throw new ServiceError(
            500,
            `請求書PDFのS3アップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
