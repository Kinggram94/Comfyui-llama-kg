# Comfyui-llama-kg

## 特性

- **底座节点**（全部带 `kg_` 前缀，与已安装的 llama-cpp-vlm 类插件互不冲突）：
  模型加载、进阶推理、参数、状态清理、卸载、token 统计、JSON 解析、BBox/Segs/Mask 转换、提示词增强预设等 13 个节点。
- **KG Skill加载器**（`kg_skill_loader`）：扫描插件 `skills/` 目录中的本地 Skill，
  选择后注入系统提示词；支持加载本地 `.md/.txt` 临时文件作为内联 Skill（≤4MB），
  并可在对话中按需加载 Skill 的 `references/` 参考文件。
- **KG 多轮对话**（`kg_multi_turn_chat`）：带聊天面板的多轮对话节点，
  支持 Skill 驱动的分阶段流程（`<kg_chat_state>` 状态协议）、
  选项按钮、历史轮数与上下文裁剪、图片附件（需 mmproj）、
  中断看门狗、一键卸载模型。
- **KG 对话增强设置**（`kg_chat_settings`）：系统提示词、采样参数、历史轮数、图片最大边长等集中配置。

## 与其他插件共存

- 节点 ID 全部使用 `kg_` 前缀，类型 `KGMODEL`/`KGPARAMS`/`KG_SKILL`/`KG_CHAT_SETTINGS` 独立，
  可与 lihaoyun6/sthao42 的 llama-cpp-vlm同时安装，节点互不相连。

## 安装

1. 将本目录放入 `ComfyUI/custom_nodes/Comfyui-llama-kg`。
2. `requirements.txt` 仅包含轻量依赖（diskcache/scipy/numpy/pillow/gguf/tqdm）；
   **llama-cpp-python 需自行预装**（兼容 0.4.2+，本插件不附带、不覆盖任何轮子）。
3. 重启 ComfyUI，节点位于分类 `llamacpp-kg`。

## 模型

- 将 GGUF 模型放入 `ComfyUI/models/LLM/`；视觉对话需在加载器中选择 `mmproj` 文件。
- Skill 放入本插件 `skills/<skill-name>/`，入口文件 `SKILL.md`（或 `SKILL.cn.md` 优先），
  参考文件放 `references/`；可选 `meta.yaml` 中 `display-name-zh`、`summary-cn` 控制显示。

## 多轮对话用法

1. `kg_model_loader` → `kg_multi_turn_chat` 的 `llama_model`。
2. 可选连接 `kg_skill_loader`（选 Skill 或加载本地提示词文件）与 `kg_chat_settings`。
3. 在聊天面板输入消息，Enter 发送（Shift+Enter 换行），回复与状态由前端自动回填工作流；
   模型常驻显存，面板右上「卸载模型」可在队列空闲时释放。
4. 图片对话：点击「插图」添加本地图片（需模型配置 mmproj）。

