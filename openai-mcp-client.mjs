import "dotenv/config";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
    
if (!apiKey) {
    console.error("OPENAI_API_KEY が設定されていません。");
    process.exit(1);
}

const client = new OpenAI({ apiKey });
const rawMcpServerUrl = process.env.MCP_SERVER_URL;
const mcpServerUrl = rawMcpServerUrl.replace(/([^:]\/)\/+/g, "$1");
const prompt = "株式会社サンプル商事への2026年1月の請求書PDFを作成して。";

const response = await client.responses.create({
    model: "gpt-5.2",
    input: prompt,
    tools: [
        {
            type: "mcp",
            server_label: "minimal-mcp-on-aws",
            server_url: mcpServerUrl,
            require_approval: "never",
        },
    ],
});

console.log(response.output_text ?? "(output_text が空です)");
