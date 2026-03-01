import OpenAI from "openai";
import { ServiceError } from "./service-error.mjs";

const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
const openAiModel = process.env.OPENAI_MODEL ?? "gpt-5.2";

function normalizeUrl(url) {
    return url.replace(/([^:]\/)\/+/g, "$1");
}

function isLoopbackHost(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];

    return history
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .map((item) => ({
            role: item.role,
            content: typeof item.content === "string" ? item.content.trim() : "",
        }))
        .filter((item) => item.content.length > 0)
        .slice(-20);
}

export async function getChatResponse({ message, history, protocol, host }) {
    if (!openAiClient) {
        throw new ServiceError(
            500,
            "OPENAI_API_KEY が設定されていないため、Chat API を利用できません。"
        );
    }

    const defaultMcpServerUrl = host ? `${protocol}://${host}/sse` : null;
    const rawMcpServerUrl = process.env.MCP_SERVER_URL ?? defaultMcpServerUrl;

    if (!rawMcpServerUrl) {
        throw new ServiceError(
            500,
            "MCP_SERVER_URL を解決できませんでした。環境変数を設定してください。"
        );
    }

    const mcpServerUrl = normalizeUrl(rawMcpServerUrl);

    let parsedMcpUrl;
    try {
        parsedMcpUrl = new URL(mcpServerUrl);
    } catch {
        throw new ServiceError(400, `MCP_SERVER_URL の形式が不正です: ${mcpServerUrl}`);
    }

    if (isLoopbackHost(parsedMcpUrl.hostname)) {
        throw new ServiceError(
            400,
            [
                "MCP_SERVER_URL が localhost/127.0.0.1 になっています。",
                "OpenAI側からはローカル環境へ接続できないため、公開URL（例: App Runner の /sse）を設定してください。",
            ].join(" ")
        );
    }

    try {
        const normalizedHistory = normalizeHistory(history);
        const input = [...normalizedHistory, { role: "user", content: message }];

        const response = await openAiClient.responses.create({
            model: openAiModel,
            input,
            tools: [
                {
                    type: "mcp",
                    server_label: "minimal-mcp-on-aws",
                    server_url: mcpServerUrl,
                    require_approval: "never",
                },
            ],
        });

        return response.output_text ?? "";
    } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        throw new ServiceError(500, `OpenAI API呼び出しに失敗しました: ${messageText}`);
    }
}
