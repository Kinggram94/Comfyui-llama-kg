import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "kg_multi_turn_chat";
const STYLE_ID = "llamacpp-kg-chat-styles";
const CHAT_MIN_HEIGHT = 300;
const CHAT_NODE_MIN_WIDTH = 400;
const CHAT_NODE_MIN_HEIGHT = 520;
const FONT_MIN = 11;
const FONT_MAX = 28;
const FONT_DEFAULT = 14;

let activeImagePreview = null;
let activeImagePreviewKeyHandler = null;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .kg-chat {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            height: 100%;
            min-height: 0;
            padding: 7px 8px;
            overflow: hidden;
            color: var(--fg-color, #dadada);
            background: var(--comfy-menu-bg, #202124);
            border: 1px solid var(--border-color, #444);
            border-radius: 5px;
            font: 12px/1.45 system-ui, sans-serif;
        }
        .kg-chat__bar {
            display: flex;
            align-items: center;
            gap: 5px;
            flex: 0 0 auto;
            min-height: 26px;
        }
        .kg-chat__chip {
            overflow: hidden;
            max-width: 90px;
            padding: 2px 7px;
            color: #f4c982;
            background: #332b1d;
            border: 1px solid #765d32;
            border-radius: 9px;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 11px;
        }
        .kg-chat__skill {
            overflow: hidden;
            flex: 1 1 auto;
            min-width: 0;
            color: var(--descrip-text, #9daab8);
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 11px;
        }
        .kg-chat__context {
            overflow: hidden;
            flex: 0 1 auto;
            max-width: 130px;
            color: var(--descrip-text, #9daab8);
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 10px;
        }
        .kg-chat__font {
            box-sizing: border-box;
            display: grid;
            grid-template-columns: 18px 24px 18px;
            height: 22px;
            flex: 0 0 auto;
            align-items: center;
            overflow: hidden;
            background: var(--comfy-input-bg, #17181a);
            border: 1px solid var(--border-color, #4b4d52);
            border-radius: 4px;
        }
        .kg-chat__font-button {
            width: 18px;
            height: 20px;
            padding: 0;
            color: var(--fg-color, #c7ced6);
            background: transparent;
            border: 0;
            cursor: pointer;
            font: 14px/20px system-ui, sans-serif;
        }
        .kg-chat__font-button:hover:not(:disabled) {
            background: #3a3e43;
        }
        .kg-chat__font-button:disabled {
            cursor: default;
            opacity: 0.3;
        }
        .kg-chat__font-value {
            overflow: hidden;
            color: var(--fg-color, #dce2e8);
            text-align: center;
            font-size: 9px;
            white-space: nowrap;
        }
        .kg-chat__unload {
            height: 22px;
            flex: 0 0 auto;
            padding: 0 7px;
            color: var(--fg-color, #b8c0ca);
            background: var(--comfy-input-bg, #17181a);
            border: 1px solid var(--border-color, #4b4d52);
            border-radius: 4px;
            cursor: pointer;
            font-size: 10px;
            white-space: nowrap;
        }
        .kg-chat__unload:hover:not(:disabled) {
            color: #f2b4b4;
            background: #3a292b;
            border-color: #70454a;
        }
        .kg-chat__unload:disabled {
            cursor: default;
            opacity: 0.45;
        }
        .kg-chat__messages {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            padding: 2px;
            scrollbar-width: thin;
        }
        .kg-chat__empty {
            display: grid;
            height: 100%;
            place-items: center;
            color: var(--descrip-text, #9ca3af);
            font-size: 12px;
        }
        .kg-chat__msg {
            box-sizing: border-box;
            margin: 0 0 7px;
            padding: 6px 8px;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            background: var(--comfy-input-bg, #292b2f);
            border: 1px solid var(--border-color, #414348);
            border-radius: 5px;
        }
        .kg-chat__msg--user {
            width: fit-content;
            max-width: calc(100% - 18px);
            margin-left: auto;
            background: #253b33;
            border-color: #3f6858;
        }
        .kg-chat__msg-role {
            display: block;
            margin-bottom: 2px;
            color: var(--descrip-text, #aeb4bd);
            font-size: 10px;
            font-weight: 600;
        }
        .kg-chat__msg-body {
            min-width: 0;
            font-size: var(--kg-chat-font-size, 14px);
            line-height: 1.55;
        }
        .kg-chat__msg-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 3px;
            min-height: 18px;
        }
        .kg-chat__msg-info {
            display: flex;
            gap: 8px;
            overflow: hidden;
            color: var(--descrip-text, #89939e);
            font-size: 9px;
            white-space: nowrap;
        }
        .kg-chat__icon {
            width: 22px;
            height: 18px;
            padding: 0;
            color: var(--fg-color, #aeb4bd);
            background: transparent;
            border: 0;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
            line-height: 18px;
        }
        .kg-chat__icon:hover {
            color: #ffffff;
            background: #3b3e43;
        }
        .kg-chat__code {
            overflow-x: auto;
            margin: 5px 0 2px;
            padding: 7px 8px;
            color: #e6edf3;
            background: #17191c;
            border: 1px solid #40444a;
            border-radius: 4px;
            white-space: pre;
            scrollbar-width: thin;
            font-family: Consolas, "Courier New", monospace;
            font-size: calc(var(--kg-chat-font-size, 14px) - 1px);
            line-height: 1.5;
        }
        .kg-chat__code-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 18px;
            margin-bottom: 3px;
        }
        .kg-chat__code-lang {
            color: #8f9aa6;
            font-size: 9px;
        }
        .kg-chat__imgs {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 2px 0 5px;
        }
        .kg-chat__img-btn {
            position: relative;
            box-sizing: border-box;
            display: block;
            width: 84px;
            height: 64px;
            flex: 0 0 84px;
            padding: 0;
            overflow: hidden;
            background: #171a19;
            border: 1px solid #4b5f56;
            border-radius: 4px;
            cursor: zoom-in;
        }
        .kg-chat__img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
        }
        .kg-chat__img-tag {
            position: absolute;
            right: 4px;
            bottom: 4px;
            padding: 1px 4px;
            color: #f2f5f3;
            background: rgba(20, 24, 22, 0.78);
            border-radius: 3px;
            font-size: 9px;
        }
        .kg-chat__options {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            flex: 0 0 auto;
        }
        .kg-chat__option {
            min-height: 24px;
            padding: 2px 8px;
            color: #e5edf6;
            background: #303d4b;
            border: 1px solid #4b657d;
            border-radius: 4px;
            cursor: pointer;
            font: inherit;
            font-size: 11px;
            text-align: left;
        }
        .kg-chat__option:hover:not(:disabled) {
            background: #3c5268;
        }
        .kg-chat__option:disabled {
            cursor: default;
            opacity: 0.55;
        }
        .kg-chat__attach {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 22px;
            padding: 0 6px;
            color: #d9ede4;
            background: #263c33;
            border: 1px solid #416957;
            border-radius: 4px;
            font-size: 10px;
        }
        .kg-chat__attach-remove {
            width: 16px;
            height: 16px;
            padding: 0;
            color: #d7ddd9;
            background: transparent;
            border: 0;
            cursor: pointer;
            font-size: 14px;
            line-height: 14px;
        }
        .kg-chat__composer {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 6px;
            flex: 0 0 auto;
        }
        .kg-chat__compose-main {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }
        .kg-chat__input {
            box-sizing: border-box;
            width: 100%;
            height: 66px;
            min-height: 44px;
            max-height: 120px;
            resize: none;
            padding: 6px 7px;
            color: var(--input-text, #f3f4f6);
            background: var(--comfy-input-bg, #17181a);
            border: 1px solid var(--border-color, #4b4d52);
            border-radius: 4px;
            outline: none;
            font: inherit;
            font-size: var(--kg-chat-font-size, 14px);
            line-height: 1.45;
        }
        .kg-chat__input:focus {
            border-color: #55a07e;
        }
        .kg-chat__actions {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .kg-chat__send {
            min-width: 56px;
            height: 30px;
            padding: 0 10px;
            color: #f4f4f5;
            background: #347257;
            border: 1px solid #438e6c;
            border-radius: 4px;
            cursor: pointer;
            font: inherit;
            font-size: 12px;
        }
        .kg-chat__send:hover:not(:disabled) {
            background: #3d8264;
        }
        .kg-chat__secondary {
            min-width: 56px;
            height: 24px;
            padding: 0 10px;
            color: var(--fg-color, #f4f4f5);
            background: var(--comfy-input-bg, #3b3e43);
            border: 1px solid var(--border-color, #565a60);
            border-radius: 4px;
            cursor: pointer;
            font: inherit;
            font-size: 11px;
        }
        .kg-chat__secondary:hover:not(:disabled) {
            background: #494d53;
        }
        .kg-chat__send:disabled,
        .kg-chat__secondary:disabled {
            cursor: default;
            opacity: 0.5;
        }
        .kg-chat__status {
            flex: 0 0 auto;
            min-height: 16px;
            overflow: hidden;
            color: var(--descrip-text, #9ca3af);
            font-size: 10px;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .kg-chat__status[data-state="busy"] {
            color: #72c69e;
        }
        .kg-chat__status[data-state="error"] {
            color: #ef8b8b;
        }
        .kg-chat__preview {
            position: fixed;
            inset: 0;
            z-index: 100000;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 42px;
            background: rgba(0, 0, 0, 0.82);
            cursor: zoom-out;
        }
        .kg-chat__preview-img {
            display: block;
            max-width: min(92vw, 1400px);
            max-height: 88vh;
            object-fit: contain;
            cursor: default;
            user-select: none;
        }
        .kg-chat__preview-close {
            position: fixed;
            top: 14px;
            right: 18px;
            width: 34px;
            height: 34px;
            padding: 0;
            color: #fff;
            background: rgba(28, 30, 33, 0.92);
            border: 1px solid #6b7077;
            border-radius: 4px;
            cursor: pointer;
            font: 24px/30px system-ui, sans-serif;
        }
        .kg-chat__preview-close:hover {
            background: #44484e;
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function firstValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function parseHistory(raw) {
    try {
        const value = JSON.parse(raw || "[]");
        if (!Array.isArray(value)) return [];
        return value.filter(
            (item) =>
                item &&
                (item.role === "user" || item.role === "assistant") &&
                typeof item.content === "string"
        );
    } catch (_) {
        return [];
    }
}

function validHistoryRaw(raw) {
    if (typeof raw !== "string") return null;
    try {
        return Array.isArray(JSON.parse(raw || "")) ? raw : null;
    } catch (_) {
        return null;
    }
}

function isHistoryJson(raw) {
    try {
        return Array.isArray(JSON.parse(raw || ""));
    } catch (_) {
        return false;
    }
}

function parseImages(raw) {
    try {
        const value = JSON.parse(raw || "[]");
        if (!Array.isArray(value)) return [];
        return value
            .filter((item) => item && typeof (item.filename ?? item.name) === "string")
            .map((item) => ({
                filename: item.filename ?? item.name,
                subfolder: item.subfolder || "",
                type: "input",
            }));
    } catch (_) {
        return [];
    }
}

function parseFlowState(raw) {
    try {
        const value = JSON.parse(raw || "{}");
        return value && typeof value === "object" ? value : {};
    } catch (_) {
        return {};
    }
}

function parseContextState(raw) {
    if (raw && typeof raw === "object") return raw;
    try {
        const value = JSON.parse(raw || "{}");
        return value && typeof value === "object" ? value : {};
    } catch (_) {
        return {};
    }
}

function parseOptions(raw) {
    try {
        const value = JSON.parse(raw || "[]");
        return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
    } catch (_) {
        return [];
    }
}

function formatTokenCount(value) {
    const tokens = Math.max(0, Number(value) || 0);
    if (tokens < 1000) return String(Math.round(tokens));
    const scaled = tokens / 1000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)}k`;
}

function formatMessageTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    const now = new Date();
    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock.slice(0, 5)}`;
}

function createElement(tag, className, text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function zeroHeightWidget(widget) {
    if (!widget || widget.__kgZeroHeight) return;
    widget.__kgZeroHeight = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    widget.draw = () => {};
    if (widget.element) widget.element.style.display = "none";
}

async function uploadChatImage(file, index) {
    const safeName = String(file.name || "image.png").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const uploadName = `kg_chat_${Date.now()}_${index}_${safeName}`;
    const body = new FormData();
    body.append("image", file, uploadName);
    body.append("type", "input");
    body.append("subfolder", "llamacpp_kg_chat");
    body.append("overwrite", "false");

    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response?.ok) throw new Error(`图片上传失败 (${response?.status || "unknown"})`);
    const result = await response.json();
    return {
        filename: result.name || uploadName,
        subfolder: result.subfolder || "llamacpp_kg_chat",
        type: "input",
    };
}

function buildChatImageUrl(imageRef) {
    if (!imageRef?.filename) return "";
    const params = new URLSearchParams({
        filename: String(imageRef.filename),
        type: String(imageRef.type || "input"),
        subfolder: String(imageRef.subfolder || ""),
    });
    return api.apiURL(`/view?${params.toString()}`);
}

function closeImagePreview() {
    if (activeImagePreviewKeyHandler) {
        document.removeEventListener("keydown", activeImagePreviewKeyHandler);
        activeImagePreviewKeyHandler = null;
    }
    activeImagePreview?.remove();
    activeImagePreview = null;
}

function openImagePreview(url, label) {
    closeImagePreview();
    const overlay = createElement("div", "kg-chat__preview");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", label || "图片预览");

    const image = createElement("img", "kg-chat__preview-img");
    image.src = url;
    image.alt = label || "图片预览";

    const closeButton = createElement("button", "kg-chat__preview-close", "×");
    closeButton.type = "button";
    closeButton.title = "关闭图片预览";
    closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeImagePreview();
    });
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeImagePreview();
    });
    for (const eventName of ["pointerdown", "mousedown", "mouseup", "dblclick", "wheel"]) {
        overlay.addEventListener(eventName, (event) => event.stopPropagation());
    }

    activeImagePreviewKeyHandler = (event) => {
        if (event.key === "Escape") closeImagePreview();
    };
    document.addEventListener("keydown", activeImagePreviewKeyHandler);
    overlay.append(image, closeButton);
    document.body.append(overlay);
    activeImagePreview = overlay;
    closeButton.focus();
}

function createMessageImages(imageRefs) {
    const validImages = (Array.isArray(imageRefs) ? imageRefs : [])
        .map((imageRef) => ({ imageRef, url: buildChatImageUrl(imageRef) }))
        .filter((item) => item.url);
    if (!validImages.length) return null;

    const gallery = createElement("div", "kg-chat__imgs");
    validImages.forEach(({ imageRef, url }, index) => {
        const previewButton = createElement("button", "kg-chat__img-btn");
        previewButton.type = "button";
        previewButton.title = `预览：${imageRef.filename}`;
        previewButton.addEventListener("click", (event) => {
            event.stopPropagation();
            openImagePreview(url, `图${index + 1}`);
        });

        const image = createElement("img", "kg-chat__img");
        image.src = url;
        image.alt = `图${index + 1}`;
        image.loading = "lazy";
        image.decoding = "async";
        previewButton.append(image, createElement("span", "kg-chat__img-tag", `图${index + 1}`));
        gallery.append(previewButton);
    });
    return gallery;
}

function createMessageContent(text, onCopy) {
    const content = createElement("div", "kg-chat__msg-body");
    const source = String(text || "");
    const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
    let cursor = 0;
    let match;

    while ((match = fence.exec(source)) !== null) {
        if (match.index > cursor) content.append(document.createTextNode(source.slice(cursor, match.index)));
        const pre = createElement("pre", "kg-chat__code");
        const language = match[1].trim();
        const codeText = match[2].replace(/\n$/, "");
        const codeHeader = createElement("div", "kg-chat__code-head");
        if (language) codeHeader.append(createElement("span", "kg-chat__code-lang", language));
        const copyCodeButton = createElement("button", "kg-chat__icon", "⧉");
        copyCodeButton.type = "button";
        copyCodeButton.title = "复制代码块";
        copyCodeButton.addEventListener("click", (event) => {
            event.stopPropagation();
            onCopy?.(codeText);
        });
        codeHeader.append(copyCodeButton);
        pre.append(codeHeader);
        const code = document.createElement("code");
        code.textContent = codeText;
        pre.append(code);
        content.append(pre);
        cursor = fence.lastIndex;
    }

    if (cursor < source.length) content.append(document.createTextNode(source.slice(cursor)));
    return content;
}

function isPromptLink(value, output) {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const sourceId = value[0];
    const outputSlot = value[1];
    const validSource =
        typeof sourceId === "number" ||
        (typeof sourceId === "string" && /^\d+$/.test(sourceId));
    return (
        validSource &&
        typeof outputSlot === "number" &&
        Number.isFinite(outputSlot) &&
        Boolean(output?.[String(sourceId)] ?? output?.[Number(sourceId)])
    );
}

function collectPromptLinks(value, output, result = new Set()) {
    if (isPromptLink(value, output)) {
        result.add(String(value[0]));
        return result;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectPromptLinks(item, output, result);
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) collectPromptLinks(item, output, result);
    }
    return result;
}

async function buildChatOnlyPrompt(node, chatInputs = null) {
    const prompt = await app.graphToPrompt();
    const output = prompt?.output;
    const targetId = String(node.id);
    if (!output || !(output[targetId] ?? output[Number(targetId)])) {
        throw new Error("当前聊天节点不在可执行提示中，请检查模型连接。");
    }

    const keep = new Set();
    const addWithAncestors = (nodeId) => {
        const id = String(nodeId);
        if (keep.has(id)) return;
        const apiNode = output[id] ?? output[Number(id)];
        if (!apiNode) return;
        keep.add(id);
        for (const sourceId of collectPromptLinks(apiNode.inputs || {}, output)) {
            addWithAncestors(sourceId);
        }
    };
    addWithAncestors(targetId);

    const scopedOutput = {};
    for (const [id, apiNode] of Object.entries(output)) {
        if (keep.has(String(id))) scopedOutput[id] = apiNode;
    }
    const targetNode = scopedOutput[targetId] ?? scopedOutput[Number(targetId)];
    if (targetNode?.inputs && chatInputs) {
        Object.assign(targetNode.inputs, chatInputs);
    }
    prompt.output = scopedOutput;
    return prompt;
}

// ---------------------------------------------------------------------------
// 节点装配
// ---------------------------------------------------------------------------

function setupChatNode(node) {
    injectStyles();
    node.properties ||= {};

    const userWidget = node.widgets?.find((widget) => widget.name === "用户消息");
    const historyWidget = node.widgets?.find((widget) => widget.name === "对话历史JSON");
    const requestWidget = node.widgets?.find((widget) => widget.name === "请求ID");
    const currentImagesWidget = node.widgets?.find((widget) => widget.name === "当前图片JSON");
    if (!userWidget || !historyWidget || !requestWidget || !currentImagesWidget || typeof node.addDOMWidget !== "function") {
        return;
    }

    if (!isHistoryJson(historyWidget.value)) {
        historyWidget.value = node.__kgLastValidHistoryRaw ?? "[]";
        requestWidget.value = "";
        currentImagesWidget.value = "[]";
    }
    let lastValidHistoryRaw = validHistoryRaw(historyWidget.value) ?? "[]";
    node.__kgLastValidHistoryRaw = lastValidHistoryRaw;

    for (const name of ["用户消息", "对话历史JSON", "请求ID", "当前图片JSON", "流程状态JSON", "选项JSON"]) {
        zeroHeightWidget(node.widgets?.find((widget) => widget.name === name));
    }
    const flowWidget = node.widgets?.find((widget) => widget.name === "流程状态JSON");
    const optionsWidget = node.widgets?.find((widget) => widget.name === "选项JSON");

    const root = createElement("div", "kg-chat");
    const bar = createElement("div", "kg-chat__bar");
    const stage = createElement("span", "kg-chat__chip", "未开始");
    const skillLabel = createElement("span", "kg-chat__skill", "普通对话");
    const context = createElement("span", "kg-chat__context", "");
    const fontControl = createElement("div", "kg-chat__font");
    const fontMinus = createElement("button", "kg-chat__font-button", "−");
    const fontValue = createElement("span", "kg-chat__font-value");
    const fontPlus = createElement("button", "kg-chat__font-button", "+");
    const unloadButton = createElement("button", "kg-chat__unload", "卸载模型");
    const messages = createElement("div", "kg-chat__messages");
    const options = createElement("div", "kg-chat__options");
    const attachments = createElement("div", "kg-chat__options");
    const composer = createElement("div", "kg-chat__composer");
    const composeMain = createElement("div", "kg-chat__compose-main");
    const input = createElement("textarea", "kg-chat__input");
    const actions = createElement("div", "kg-chat__actions");
    const sendButton = createElement("button", "kg-chat__send", "发送");
    const imageButton = createElement("button", "kg-chat__secondary", "插图");
    const clearButton = createElement("button", "kg-chat__secondary", "清空");
    const status = createElement("div", "kg-chat__status", "准备就绪");
    const fileInput = document.createElement("input");

    input.placeholder = "输入消息，Enter 发送，Shift+Enter 换行";
    input.rows = 2;
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    sendButton.type = "button";
    imageButton.type = "button";
    clearButton.type = "button";
    fontMinus.type = "button";
    fontPlus.type = "button";
    fontMinus.title = "减小聊天字体";
    fontPlus.title = "增大聊天字体";
    unloadButton.type = "button";
    unloadButton.title = "卸载当前 llama.cpp 模型";

    fontControl.append(fontMinus, fontValue, fontPlus);
    bar.append(stage, skillLabel, context, fontControl, unloadButton);
    composeMain.append(input);
    actions.append(sendButton, imageButton, clearButton);
    composer.append(composeMain, actions);
    root.append(bar, messages, options, attachments, composer, status, fileInput);

    for (const eventName of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "wheel"]) {
        root.addEventListener(eventName, (event) => event.stopPropagation());
    }
    root.addEventListener("keydown", (event) => event.stopPropagation());

    const applyFontSize = (value) => {
        const numeric = Number(value);
        const next = Math.min(FONT_MAX, Math.max(FONT_MIN, Number.isFinite(numeric) ? Math.round(numeric) : FONT_DEFAULT));
        node.properties.kgChatFontSize = next;
        root.style.setProperty("--kg-chat-font-size", `${next}px`);
        fontValue.textContent = String(next);
        fontMinus.disabled = next <= FONT_MIN;
        fontPlus.disabled = next >= FONT_MAX;
    };
    fontMinus.addEventListener("click", () => applyFontSize(Number(node.properties.kgChatFontSize) - 1));
    fontPlus.addEventListener("click", () => applyFontSize(Number(node.properties.kgChatFontSize) + 1));
    applyFontSize(node.properties.kgChatFontSize);

    const commitHistoryRaw = (raw, { allowEmptyRegression = false } = {}) => {
        const validRaw = validHistoryRaw(raw);
        if (validRaw === null) return false;
        if (
            !allowEmptyRegression &&
            parseHistory(validRaw).length === 0 &&
            parseHistory(lastValidHistoryRaw).length > 0
        ) {
            return false;
        }
        historyWidget.value = validRaw;
        lastValidHistoryRaw = validRaw;
        node.__kgLastValidHistoryRaw = validRaw;
        return true;
    };

    const protectedHistory = () => {
        if (!commitHistoryRaw(historyWidget.value)) {
            historyWidget.value = lastValidHistoryRaw;
            status.textContent = "检测到历史数据异常，已恢复上一次有效对话";
            status.dataset.state = "error";
        }
        return parseHistory(lastValidHistoryRaw);
    };

    const render = () => {
        const history = protectedHistory();
        messages.replaceChildren();
        if (!history.length) {
            messages.append(createElement("div", "kg-chat__empty", "暂无对话，输入消息开始"));
            return;
        }

        history.forEach((item, index) => {
            const imageCount = Array.isArray(item.images) ? item.images.length : 0;
            const block = createElement("div", `kg-chat__msg kg-chat__msg--${item.role}`);
            block.append(createElement(
                "span",
                "kg-chat__msg-role",
                item.role === "user" ? (imageCount ? `用户 · 图片${imageCount}` : "用户") : "助手"
            ));

            if (item.role === "user") {
                const gallery = createMessageImages(item.images);
                if (gallery) block.append(gallery);
            }
            block.append(createMessageContent(item.content, copyText));

            const meta = createElement("div", "kg-chat__msg-meta");
            const info = createElement("div", "kg-chat__msg-info");
            const tokenCount = Number(item.token_count);
            if (Number.isFinite(tokenCount) && tokenCount >= 0) {
                info.append(createElement("span", "", `${Math.round(tokenCount)} tok`));
            }
            const formattedTime = formatMessageTime(item.created_at);
            if (formattedTime) {
                info.append(createElement("span", "", formattedTime));
            }
            meta.append(info);

            const controls = createElement("div");
            const copyButton = createElement("button", "kg-chat__icon", "⧉");
            copyButton.type = "button";
            copyButton.title = "复制这条消息";
            copyButton.addEventListener("click", (event) => {
                event.stopPropagation();
                copyText(item.content);
            });
            controls.append(copyButton);
            if (item.role === "assistant" && index === history.length - 1) {
                const regenerateButton = createElement("button", "kg-chat__icon", "↻");
                regenerateButton.type = "button";
                regenerateButton.title = "重新生成这条回复";
                regenerateButton.addEventListener("click", (event) => {
                    event.stopPropagation();
                    regenerateLastReply();
                });
                controls.append(regenerateButton);
            }
            meta.append(controls);
            block.append(meta);
            messages.append(block);
        });
        messages.scrollTop = messages.scrollHeight;
    };

    const renderFlow = () => {
        const state = parseFlowState(flowWidget?.value);
        stage.textContent = String(state.stage || "未开始");
        stage.title = stage.textContent;
        skillLabel.textContent = state.skill_name || state.skill || "普通对话";
        skillLabel.title = skillLabel.textContent;
        options.replaceChildren();
        for (const value of parseOptions(optionsWidget?.value || "[]")) {
            const button = createElement("button", "kg-chat__option", value);
            button.type = "button";
            button.title = "发送此选项";
            button.addEventListener("click", () => {
                if (node.__kgChatBusy) return;
                input.value = value;
                send();
            });
            options.append(button);
        }
    };

    const renderContext = () => {
        const state = parseContextState(node.properties.kgChatContext);
        const usedTokens = Math.max(0, Number(state.used_tokens) || 0);
        const promptBudget = Math.max(0, Number(state.prompt_budget) || 0);
        const rounds = Math.max(0, Number(state.current_rounds) || 0);
        const maxRounds = Math.max(0, Number(state.max_rounds) || 0);
        const trimmed = Math.max(0, Number(state.trimmed_messages) || 0);
        if (!promptBudget) {
            context.textContent = "";
            context.title = "完成一次回复后显示上下文占用估算";
            return;
        }
        const trimmedNote = trimmed > 0 ? ` · 裁${trimmed}` : "";
        context.textContent = `≈${formatTokenCount(usedTokens)}/${formatTokenCount(promptBudget)} · ${rounds}/${maxRounds}轮${trimmedNote}`;
        context.title = [
            `已用约 ${Math.round(usedTokens)} tokens（估算）`,
            `可用输入约 ${Math.round(promptBudget)} tokens`,
            `模型上下文上限 ${Math.round(Number(state.context_limit) || 0)} tokens`,
            `当前保留 ${rounds}/${maxRounds} 轮`,
            trimmed > 0 ? `本轮裁剪了 ${trimmed} 条历史消息` : "本轮未裁剪历史",
        ].join("\n");
    };

    const renderAttachments = () => {
        const images = parseImages(currentImagesWidget.value);
        attachments.replaceChildren();
        images.forEach((imageRef, index) => {
            const chip = createElement("span", "kg-chat__attach");
            chip.title = imageRef.filename;
            chip.append(createElement("span", "", `图片${index + 1}`));
            const removeButton = createElement("button", "kg-chat__attach-remove", "×");
            removeButton.type = "button";
            removeButton.title = `移除图片${index + 1}`;
            removeButton.addEventListener("click", () => {
                const next = parseImages(currentImagesWidget.value);
                next.splice(index, 1);
                currentImagesWidget.value = JSON.stringify(next);
                renderAttachments();
                node.graph?.setDirtyCanvas?.(true, true);
            });
            chip.append(removeButton);
            attachments.append(chip);
        });
        attachments.style.display = images.length ? "flex" : "none";
    };

    const copyText = async (value) => {
        if (!value) {
            status.textContent = "暂无可复制内容";
            status.dataset.state = "error";
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
        } catch (_) {
            const textarea = document.createElement("textarea");
            textarea.value = value;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.append(textarea);
            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        }
        status.textContent = "已复制";
        status.dataset.state = "idle";
    };

    const regenerateLastReply = () => {
        if (node.__kgChatBusy) return;
        const history = protectedHistory();
        const assistantIndex = history.length - 1;
        const userIndex = assistantIndex - 1;
        if (
            assistantIndex < 1 ||
            history[assistantIndex]?.role !== "assistant" ||
            history[userIndex]?.role !== "user"
        ) {
            return;
        }

        const assistantMessage = history[assistantIndex];
        const userMessage = history[userIndex];
        commitHistoryRaw(JSON.stringify(history.slice(0, userIndex)), { allowEmptyRegression: true });
        input.value = userMessage.content;
        currentImagesWidget.value = JSON.stringify(userMessage.images || []);
        if (flowWidget) {
            const fallbackState = parseFlowState(flowWidget.value);
            fallbackState.final_result = "";
            fallbackState.stage = "重新生成";
            flowWidget.value = JSON.stringify(assistantMessage.flow_before || fallbackState);
        }
        if (optionsWidget) optionsWidget.value = "[]";
        render();
        renderFlow();
        renderAttachments();
        send();
    };

    const setBusy = (busy, message = busy ? "正在生成..." : "准备就绪", state = busy ? "busy" : "idle") => {
        node.__kgChatBusy = busy;
        sendButton.disabled = busy;
        imageButton.disabled = busy;
        clearButton.disabled = busy;
        input.disabled = busy;
        options.querySelectorAll("button").forEach((button) => {
            button.disabled = busy;
        });
        status.textContent = message;
        status.dataset.state = state;
    };

    const send = async () => {
        const text = input.value.trim();
        if (!text || node.__kgChatBusy) return;

        protectedHistory();
        userWidget.value = text;
        requestWidget.value = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setBusy(true);
        node.graph?.setDirtyCanvas?.(true, true);

        try {
            const prompt = await buildChatOnlyPrompt(node, {
                "用户消息": text,
                "对话历史JSON": lastValidHistoryRaw,
                "请求ID": requestWidget.value,
                "当前图片JSON": currentImagesWidget.value,
                "流程状态JSON": flowWidget?.value || "{}",
                "选项JSON": optionsWidget?.value || "[]",
            });
            await api.queuePrompt(0, prompt);
            status.textContent = "已加入队列...";
            status.dataset.state = "busy";
        } catch (error) {
            setBusy(false, `加入队列失败：${error?.message || error}`, "error");
        }
    };

    sendButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        send();
    });

    unloadButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (node.__kgUnloadBusy) return;
        node.__kgUnloadBusy = true;
        unloadButton.disabled = true;
        status.textContent = "正在卸载模型...";
        status.dataset.state = "busy";
        try {
            const response = await api.fetchApi("/llamacpp_kg/unload", { method: "POST" });
            let payload = {};
            try {
                payload = await response.json();
            } catch (_) {
                payload = {};
            }
            if (!response.ok || payload.ok === false) {
                if (response.status === 409) {
                    throw new Error("当前有运行中或排队任务，请等待完成后再卸载模型");
                }
                throw new Error(payload.error || `HTTP ${response.status}`);
            }
            status.textContent = payload.unloaded ? "模型已卸载" : "当前没有已加载的模型";
            status.dataset.state = "idle";
        } catch (error) {
            status.textContent = `卸载失败：${error?.message || error}`;
            status.dataset.state = "error";
        } finally {
            node.__kgUnloadBusy = false;
            unloadButton.disabled = false;
        }
    });

    imageButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = "";
        if (!files.length || node.__kgChatBusy) return;

        setBusy(true, "正在上传图片...");
        try {
            const current = parseImages(currentImagesWidget.value);
            const startIndex = current.length;
            for (let index = 0; index < files.length; index += 1) {
                current.push(await uploadChatImage(files[index], startIndex + index));
            }
            currentImagesWidget.value = JSON.stringify(current);
            renderAttachments();
            setBusy(false, `已插入 ${files.length} 张图片`);
            node.graph?.setDirtyCanvas?.(true, true);
            input.focus();
        } catch (error) {
            setBusy(false, `插入图片失败：${error?.message || error}`, "error");
        }
    });

    clearButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitHistoryRaw("[]", { allowEmptyRegression: true });
        userWidget.value = "";
        requestWidget.value = `${Date.now()}-clear`;
        currentImagesWidget.value = "[]";
        if (flowWidget) flowWidget.value = "{}";
        if (optionsWidget) optionsWidget.value = "[]";
        node.properties.kgChatContext = {};
        input.value = "";
        render();
        renderFlow();
        renderContext();
        renderAttachments();
        setBusy(false, "会话已清空");
        node.graph?.setDirtyCanvas?.(true, true);
    });

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    });

    // 布局契约：minHeight 下限 + 无 maxHeight → 前端把节点剩余空间全部分给面板，
    // 节点过小时前端布局器自动扩高。不改 computeSize / onResize / setSize。
    node.addDOMWidget("kg_chat_panel", "kg_chat_panel", root, {
        getMinHeight: () => CHAT_MIN_HEIGHT,
        hideOnZoom: false,
        serialize: false,
    });

    const renderAll = () => {
        render();
        renderFlow();
        renderContext();
        renderAttachments();
    };

    const originalOnExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        originalOnExecuted?.apply(this, arguments);
        const sent = Boolean(firstValue(output?.已发送));
        const previousHistory = parseHistory(lastValidHistoryRaw);
        const rawHistory = firstValue(output?.对话历史JSON);
        const candidateRaw = validHistoryRaw(rawHistory);
        const candidateHistory = candidateRaw === null ? null : parseHistory(candidateRaw);
        let historyError = "";
        if (candidateHistory === null) {
            if (sent || typeof rawHistory === "string") {
                historyError = "返回的历史数据异常，已保留发送前的对话";
            }
        } else if (candidateHistory.length === 0 && (sent || previousHistory.length > 0)) {
            historyError = "返回了异常空历史，已保留发送前的对话";
        } else {
            commitHistoryRaw(candidateRaw);
        }
        const rawFlow = firstValue(output?.流程状态JSON);
        if (flowWidget && typeof rawFlow === "string") flowWidget.value = rawFlow;
        const rawOptions = firstValue(output?.选项JSON);
        if (optionsWidget) optionsWidget.value = typeof rawOptions === "string" ? rawOptions : "[]";
        const rawContextState = firstValue(output?.上下文状态JSON);
        if (typeof rawContextState === "string") {
            node.properties.kgChatContext = parseContextState(rawContextState);
        }
        if (sent && !historyError) {
            userWidget.value = "";
            currentImagesWidget.value = "[]";
            input.value = "";
        }
        renderAll();
        if (historyError) {
            setBusy(false, historyError, "error");
        } else {
            setBusy(false);
        }
        this.graph?.setDirtyCanvas?.(true, true);
    };

    const originalOnConfigure = node.onConfigure;
    node.onConfigure = function () {
        const result = originalOnConfigure?.apply(this, arguments);
        window.setTimeout(() => {
            applyFontSize(this.properties?.kgChatFontSize);
            renderAll();
        }, 0);
        return result;
    };

    const handleExecutionFailure = () => {
        if (!node.__kgChatBusy) return;
        setBusy(false, "生成失败或已中断，请查看 ComfyUI 日志", "error");
    };
    api.addEventListener("execution_error", handleExecutionFailure);
    api.addEventListener("execution_interrupted", handleExecutionFailure);

    const originalOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        api.removeEventListener("execution_error", handleExecutionFailure);
        api.removeEventListener("execution_interrupted", handleExecutionFailure);
        return originalOnRemoved?.apply(this, arguments);
    };

    node.setSize([
        Math.max(node.size?.[0] || 0, CHAT_NODE_MIN_WIDTH),
        Math.max(node.size?.[1] || 0, CHAT_NODE_MIN_HEIGHT),
    ]);
    window.setTimeout(renderAll, 0);
}

app.registerExtension({
    name: "llamacpp_kg.MultiTurnChat",
    nodeCreated(node) {
        if (node.constructor?.comfyClass === NODE_TYPE) setupChatNode(node);
    },
});
