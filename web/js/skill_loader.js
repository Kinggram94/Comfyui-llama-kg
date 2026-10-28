import { app } from "../../../scripts/app.js";

const NODE_TYPE = "kg_skill_loader";
const STYLE_ID = "llamacpp-kg-skill-styles";
const BOX_HEIGHT = 104; // 前端按 computedHeight-20px 渲染 DOM 元素，104 → 84px 可容纳三行内容

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .kg-skillbox {
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            gap: 5px;
            width: 100%;
            height: 100%;
            padding: 7px 8px;
            overflow: hidden;
            color: var(--fg-color, #dadada);
            background: var(--comfy-input-bg, #17181a);
            border: 1px solid var(--border-color, #444);
            border-radius: 5px;
            font: 11px/1.4 system-ui, sans-serif;
        }
        .kg-skillbox__row {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }
        .kg-skillbox__label {
            flex: 0 0 auto;
            color: var(--descrip-text, #888);
        }
        .kg-skillbox__path {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            color: var(--input-text, #e5e7eb);
            text-overflow: ellipsis;
            white-space: nowrap;
            direction: rtl;
            text-align: left;
        }
        .kg-skillbox__buttons {
            display: flex;
            gap: 6px;
        }
        .kg-skillbox__button {
            flex: 1 1 auto;
            min-height: 24px;
            padding: 2px 8px;
            color: var(--input-text, #e5e7eb);
            background: var(--comfy-menu-bg, #202124);
            border: 1px solid var(--border-color, #4b4d52);
            border-radius: 4px;
            cursor: pointer;
            font: inherit;
        }
        .kg-skillbox__button:hover:not(:disabled) {
            border-color: #55a07e;
        }
        .kg-skillbox__button:disabled {
            cursor: default;
            opacity: 0.45;
        }
        .kg-skillbox__status {
            overflow: hidden;
            color: var(--descrip-text, #888);
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
}

function zeroHeightWidget(widget) {
    if (!widget || widget.__kgZeroHeight) return;
    widget.__kgZeroHeight = true;
    widget.computeSize = () => [0, -4];
    widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
    widget.draw = () => {};
    if (widget.element) widget.element.style.display = "none";
}

function createElement(tag, className, text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

app.registerExtension({
    name: "llamacpp_kg.SkillLoader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const hiddenPath = nodeData.input?.hidden?.skill_folder_path;
        const skillPath = String(
            typeof hiddenPath === "string" ? hiddenPath : hiddenPath?.default || ""
        );

        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalOnNodeCreated?.apply(this, arguments);
            if (typeof this.addDOMWidget !== "function") return;
            if (this.__kgSkillBox) return;

            const node = this;
            injectStyles();

            const getWidget = (name) => node.widgets?.find((item) => item?.name === name);
            const setWidgetValue = (name, value) => {
                const widget = getWidget(name);
                if (widget) widget.value = value;
            };

            zeroHeightWidget(getWidget("加载文件名"));
            zeroHeightWidget(getWidget("加载文件内容"));

            const root = createElement("div", "kg-skillbox");
            const pathRow = createElement("div", "kg-skillbox__row");
            const label = createElement("span", "kg-skillbox__label", "Skill目录：");
            const path = createElement("span", "kg-skillbox__path", skillPath);
            path.title = skillPath;
            pathRow.append(label, path);

            const buttons = createElement("div", "kg-skillbox__buttons");
            const loadButton = createElement("button", "kg-skillbox__button", "加载 Skill/提示词…");
            const clearButton = createElement("button", "kg-skillbox__button", "清除文件");
            buttons.append(loadButton, clearButton);

            const status = createElement("div", "kg-skillbox__status", "未加载临时文件");
            root.append(pathRow, buttons, status);

            for (const eventName of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "wheel"]) {
                root.addEventListener(eventName, (event) => event.stopPropagation());
            }

            // 布局契约：minHeight = maxHeight = 定高框，交给前端布局器，
            // 不改 computeSize / onResize / setSize。
            this.addDOMWidget("kg_skill_file_box", "kg_skill_file_box", root, {
                getMinHeight: () => BOX_HEIGHT,
                getMaxHeight: () => BOX_HEIGHT,
                hideOnZoom: false,
                serialize: false,
            });

            const refreshStatus = () => {
                const fileName = String(getWidget("加载文件名")?.value || "").trim();
                const content = String(getWidget("加载文件内容")?.value || "");
                const loaded = Boolean(fileName && content.trim());
                status.textContent = loaded ? `已加载：${fileName}` : "未加载临时文件";
                status.title = status.textContent;
                clearButton.disabled = !loaded;
            };

            loadButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".md,.txt,text/markdown,text/plain";
                input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const extension = file.name.toLowerCase().split(".").pop();
                    if (extension !== "md" && extension !== "txt") {
                        status.textContent = "仅支持 .md 或 .txt 文件";
                        return;
                    }
                    const reader = new FileReader();
                    reader.onerror = () => {
                        status.textContent = "文件读取失败";
                    };
                    reader.onload = () => {
                        setWidgetValue("加载文件名", file.name);
                        setWidgetValue("加载文件内容", String(reader.result || ""));
                        const skillWidget = getWidget("skill");
                        if (skillWidget && skillWidget.value !== "自动选择") skillWidget.value = "自动选择";
                        refreshStatus();
                        node.graph?.setDirtyCanvas?.(true, true);
                    };
                    reader.readAsText(file, "UTF-8");
                };
                input.click();
            });

            clearButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                setWidgetValue("加载文件名", "");
                setWidgetValue("加载文件内容", "");
                refreshStatus();
                node.graph?.setDirtyCanvas?.(true, true);
            });

            const originalOnConfigure = node.onConfigure;
            node.onConfigure = function () {
                const result = originalOnConfigure?.apply(this, arguments);
                window.setTimeout(refreshStatus, 0);
                return result;
            };
            refreshStatus();
        };
    },
});
