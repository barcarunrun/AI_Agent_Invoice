import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    ServiceError,
    createMcpServer,
    generateInvoicePdf,
    getSignedInvoiceDownloadUrlByS3Key,
    getChatResponse,
    invoiceRequestSchema,
    uploadInvoicePdf,
} from "./service.mjs";

const app = express();
app.set("trust proxy", true);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const indexHtmlPath = path.join(publicDir, "index.html");

const transports = new Map();

const basicAuthUser = process.env.BASIC_AUTH_USER;
const basicAuthPass = process.env.BASIC_AUTH_PASS;

function requireBasicAuth(req, res, next) {
    if (!basicAuthUser || !basicAuthPass) {
        next();
        return;
    }

    const authorization = req.get("authorization");
    if (!authorization?.startsWith("Basic ")) {
        res.set("WWW-Authenticate", 'Basic realm="Chat UI", charset="UTF-8"');
        res.status(401).send("Authentication required");
        return;
    }

    let decoded = "";
    try {
        decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
    } catch {
        res.set("WWW-Authenticate", 'Basic realm="Chat UI", charset="UTF-8"');
        res.status(401).send("Invalid authentication header");
        return;
    }

    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
        res.set("WWW-Authenticate", 'Basic realm="Chat UI", charset="UTF-8"');
        res.status(401).send("Invalid authentication header");
        return;
    }

    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    if (user !== basicAuthUser || pass !== basicAuthPass) {
        res.set("WWW-Authenticate", 'Basic realm="Chat UI", charset="UTF-8"');
        res.status(401).send("Unauthorized");
        return;
    }

    next();
}

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/api/chat", async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
        res.status(400).json({ error: "message は必須です。" });
        return;
    }

    try {
        const text = await getChatResponse({
            message,
            history,
            protocol: req.protocol,
            host: req.get("host"),
        });

        res.status(200).json({ text });
    } catch (error) {
        if (error instanceof ServiceError) {
            res.status(error.status).json({ error: error.message });
            return;
        }

        const messageText = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: messageText });
    }
});

app.post("/api/invoices/generate", async (req, res) => {
    const parsed = invoiceRequestSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "company_name と billing_month(YYYY-MM) を指定してください。",
        });
        return;
    }

    const { company_name, billing_month } = parsed.data;

    try {
        const { invoice, pdfBuffer } = await generateInvoicePdf(company_name, billing_month);
        const filename = `invoice-${invoice.billingMonth}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename=\"${filename}\"`);
        res.status(200).send(pdfBuffer);
    } catch (error) {
        if (error instanceof ServiceError) {
            res.status(error.status).json({ error: error.message });
            return;
        }

        const messageText = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: messageText });
    }
});

app.post("/api/invoices/upload-to-s3", async (req, res) => {
    const parsed = invoiceRequestSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "company_name と billing_month(YYYY-MM) を指定してください。",
        });
        return;
    }

    const { company_name, billing_month } = parsed.data;

    try {
        const { invoice, uploadResult } = await uploadInvoicePdf(company_name, billing_month);

        res.status(200).json({
            message: `${invoice.companyName} / ${invoice.billingMonth} の請求書PDFをS3にアップロードしました。`,
            ...uploadResult,
        });
    } catch (error) {
        if (error instanceof ServiceError) {
            res.status(error.status).json({ error: error.message });
            return;
        }

        const messageText = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: messageText });
    }
});

app.get("/api/invoices/download", async (req, res) => {
    const key = typeof req.query?.key === "string" ? req.query.key : "";

    if (!key) {
        res.status(400).json({ error: "key は必須です。" });
        return;
    }

    try {
        const signedUrl = await getSignedInvoiceDownloadUrlByS3Key(key);
        res.redirect(302, signedUrl);
    } catch (error) {
        if (error instanceof ServiceError) {
            res.status(error.status).json({ error: error.message });
            return;
        }

        const messageText = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: messageText });
    }
});

app.get("/", requireBasicAuth, (_req, res) => {
    res.sendFile(indexHtmlPath);
});

app.get("/index.html", requireBasicAuth, (_req, res) => {
    res.sendFile(indexHtmlPath);
});

app.use(express.static(publicDir));

app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const mcp = createMcpServer();

    transports.set(transport.sessionId, transport);
    transport.onclose = () => {
        transports.delete(transport.sessionId);
    };

    await mcp.connect(transport);
});

app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;

    if (typeof sessionId !== "string") {
        res.status(400).send("Missing sessionId");
        return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).send("Session not found");
        return;
    }

    await transport.handlePostMessage(req, res, req.body);
});

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => console.log(`listening on ${port}`));
