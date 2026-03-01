import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findMonthlyInvoice, getAvailableBillingMonths, uploadInvoicePdf } from "./invoiceService.mjs";

const companySalesTable = [
    { companyName: "株式会社サンプル商事", sales: "24億円", fiscalYear: "2023年度" },
    { companyName: "株式会社テックリンク", sales: "8.4億円", fiscalYear: "2023年度" },
    { companyName: "株式会社ブルースカイ", sales: "15.2億円", fiscalYear: "2023年度" },
];

function normalizeCompanyName(companyName) {
    return companyName
        .replaceAll(/[\s　]/g, "")
        .replace(/^株式会社/, "")
        .toLowerCase();
}

function findCompanySales(companyName) {
    const normalizedInput = normalizeCompanyName(companyName);

    return companySalesTable.find((item) => {
        const normalizedCandidate = normalizeCompanyName(item.companyName);

        return (
            normalizedCandidate === normalizedInput ||
            normalizedCandidate.includes(normalizedInput) ||
            normalizedInput.includes(normalizedCandidate)
        );
    });
}

export function createMcpServer() {
    const mcp = new McpServer({ name: "minimal-mcp-on-aws", version: "1.0.0" });

    mcp.tool("healthcheck", {}, async () => ({
        content: [{ type: "text", text: "ok" }],
    })); 

    mcp.tool(
        "get_company_sales",
        {
            company_name: z.string().min(1).describe("売上を知りたい会社名"),
        },
        async ({ company_name }) => {
            const result = findCompanySales(company_name);

            if (!result) {
                const knownCompanies = companySalesTable.map((item) => item.companyName).join("、");
                return {
                    content: [
                        {
                            type: "text",
                            text: `会社名「${company_name}」の売上は見つかりませんでした。現在対応している会社: ${knownCompanies}`,
                        },
                    ],
                    isError: true,
                };
            }

            return {
                content: [
                    {
                        type: "text",
                        text: `${result.companyName}の売上（${result.fiscalYear}）: ${result.sales}`,
                    },
                ],
            };
        }
    );

    mcp.tool(
        "get_monthly_invoice",
        {
            company_name: z.string().min(1).describe("請求金額を知りたい会社名"),
            billing_month: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .describe("請求対象月（YYYY-MM）"),
        },
        async ({ company_name, billing_month }) => {
            const invoice = findMonthlyInvoice(company_name, billing_month);

            if (!invoice) {
                const availableMonths = getAvailableBillingMonths(company_name);
                const monthGuide =
                    availableMonths.length > 0
                        ? `指定可能な月: ${availableMonths.join("、")}`
                        : "この会社は請求データ未登録です";

                return {
                    content: [
                        {
                            type: "text",
                            text: `会社名「${company_name}」の${billing_month}の請求金額は見つかりませんでした。${monthGuide}`,
                        },
                    ],
                    isError: true,
                };
            }

            const detailLines = invoice.details
                .map((detail) => `- ${detail.item}: ${detail.amount}`)
                .join("\n");

            return {
                content: [
                    {
                        type: "text",
                        text: `${invoice.companyName}の請求金額（${invoice.billingMonth}）: ${invoice.amount}\n明細:\n${detailLines}`,
                    },
                ],
            };
        }
    );

    mcp.tool(
        "issue_monthly_invoice_pdf",
        {
            company_name: z.string().min(1).describe("請求書を発行したい会社名"),
            billing_month: z
                .string()
                .regex(/^\d{4}-\d{2}$/)
                .describe("請求対象月（YYYY-MM）"),
        },
        async ({ company_name, billing_month }) => {
            const invoice = findMonthlyInvoice(company_name, billing_month);

            if (!invoice) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `会社名「${company_name}」の${billing_month}の請求データが見つからないため、請求書を発行できませんでした。`,
                        },
                    ],
                    isError: true,
                };
            }

            try {
                const { uploadResult } = await uploadInvoicePdf(company_name, billing_month);
                const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
                const displayDownloadUrl =
                    uploadResult.downloadPath && publicBaseUrl
                        ? `${publicBaseUrl}${uploadResult.downloadPath}`
                        : uploadResult.downloadPath || uploadResult.signedUrl;

                return {
                    content: [
                        {
                            type: "text",
                            text: [
                                `${invoice.companyName} / ${invoice.billingMonth} の請求書はこちらです。`,
                                `ダウンロードURL(7日有効): ${displayDownloadUrl}`,
                            ].join("\n"),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `請求書PDFの発行に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    return mcp;
}
