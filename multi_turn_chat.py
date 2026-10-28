# -*- coding: utf-8 -*-
"""KG 多轮对话：Skill 驱动的多轮聊天节点。

移植自 comfyUI-llama-TE 的 multi_turn_chat，模型基础设施改为
ComfyUI-llama-cpp_vlm 的 KG_STORAGE（含中断看门狗与中断传播）。
"""

import base64
import inspect
import io
import json
import os
import re
import threading
import time

from aiohttp import web
import comfy.model_management as mm
import folder_paths
from PIL import Image
from server import PromptServer

from .nodes import KG_STORAGE, reset_llama_abort_state, strip_think_block
from .skill_loader import (
    build_inline_skill_system_prompt,
    get_skill,
    read_reference,
    read_skill_body,
)

try:
    from llama_cpp._internals import LlamaDecodeAbort
except Exception:
    LlamaDecodeAbort = None


@PromptServer.instance.routes.post("/llamacpp_kg/unload")
async def _kg_unload_model_route(request):
    prompt_queue = getattr(PromptServer.instance, "prompt_queue", None)
    if prompt_queue is not None:
        running, queued = prompt_queue.get_current_queue_volatile()
        if running or queued:
            return web.json_response(
                {"ok": False, "error": "ComfyUI 有正在运行或排队的任务，请等待队列空闲后再卸载模型。"},
                status=409,
            )

    was_loaded = KG_STORAGE.llm is not None
    KG_STORAGE.clean(clear_all=True)
    print(
        f"[llamacpp-kg] model unload requested from multi-turn chat: "
        f"{'unloaded' if was_loaded else 'no model was loaded'}",
        flush=True,
    )
    return web.json_response({"ok": True, "unloaded": was_loaded})


DEFAULT_CHAT_SYSTEM_PROMPT = "你是一个有帮助的AI助手。"
SKILL_STATE_TAG = re.compile(r"<kg_chat_state>\s*(\{.*?\})\s*</kg_chat_state>", re.DOTALL)
SKILL_EXECUTION_PROTOCOL = """
你正在通过 ComfyUI 的本地 Skill 执行器工作。严格遵循下方当前 Skill，并遵守以下交互协议：
1. 只完成当前 Skill 能在文本对话中完成的工作。Skill 提到画布、媒体生成、联网工具或 Hub agent 时，不得声称已经执行；应输出对应方案、提示词或说明当前需要连接的 ComfyUI 节点。
2. 信息不足或到达确认门时，先提问并等待用户。每次只推进当前阶段，不得替用户确认。
3. 回复正文之后必须追加一个状态标记，且标记必须是回复的最后内容：
<kg_chat_state>{"stage":"当前阶段","options":["选项1","选项2"],"load_references":[],"final":false}</kg_chat_state>
4. 需要用户选择时，options 提供 2 到 6 个可直接作为用户回复的完整选项；开放问题可以使用空数组。
5. Skill 要求读取 reference 时，如果该文件尚未出现在“已加载 references”，必须先把相对路径写入 load_references。执行器会加载文件并让你重新回答，不要猜测文件内容。
6. 只有已经交付当前 Skill 要求的最终文本产物时才设置 final=true。最终产物必须完整写在状态标记之前。
7. 使用简体中文交流和输出；协议字段、H3 固定字段、标签以及用户要求原样保留的内容除外。
""".strip()


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------

def _call_chat_completion(llm, *, messages, params: dict) -> dict:
    """兼容不同 llama-cpp-python 版本的参数名差异。"""
    kwargs = dict(params or {})
    kwargs["messages"] = messages

    try:
        sig = inspect.signature(llm.create_chat_completion)
        allowed = sig.parameters
        has_var_kw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in allowed.values())
    except Exception:
        sig = None
        allowed = {}
        has_var_kw = True

    if sig is not None:
        if "presence_penalty" in kwargs and "presence_penalty" not in allowed and "present_penalty" in allowed:
            kwargs["present_penalty"] = kwargs.pop("presence_penalty")
        if "present_penalty" in kwargs and "present_penalty" not in allowed and "presence_penalty" in allowed:
            kwargs["presence_penalty"] = kwargs.pop("present_penalty")

        reasoning_keys = {
            "reasoning_budget",
            "reasoning_start",
            "reasoning_end",
            "reasoning_budget_message",
            "reasoning_start_in_prompt",
            "reasoning_start_max_tokens",
        }
        if "reasoning_budget" not in allowed:
            kwargs = {k: v for k, v in kwargs.items() if k not in reasoning_keys}
        if not has_var_kw:
            kwargs = {k: v for k, v in kwargs.items() if k in allowed}

    return llm.create_chat_completion(**kwargs)


def _chat_completion_with_abort(messages, seed, params: dict):
    """带 ComfyUI 中断看门狗的补全调用；中断时抛出 InterruptProcessingException。"""
    if mm.processing_interrupted():
        reset_llama_abort_state(KG_STORAGE.llm)
        raise mm.InterruptProcessingException()

    reset_llama_abort_state(KG_STORAGE.llm)

    aborted_by_watchdog = threading.Event()
    stop_monitor = threading.Event()

    def _abort_watchdog():
        while not stop_monitor.wait(0.05):
            if mm.processing_interrupted():
                aborted_by_watchdog.set()
                try:
                    if KG_STORAGE.llm is not None and hasattr(KG_STORAGE.llm, "abort"):
                        KG_STORAGE.llm.abort()
                except Exception:
                    pass
                break

    watchdog = threading.Thread(target=_abort_watchdog, daemon=True)
    watchdog.start()
    try:
        call_params = dict(params or {})
        call_params["seed"] = seed
        return _call_chat_completion(KG_STORAGE.llm, messages=messages, params=call_params)
    except Exception as err:
        err_name = type(err).__name__
        err_str = str(err).lower()
        if (
            err_name == "LlamaDecodeAbort"
            or (LlamaDecodeAbort is not None and isinstance(err, LlamaDecodeAbort))
            or "llama_decode aborted" in err_str
            or aborted_by_watchdog.is_set()
            or mm.processing_interrupted()
        ):
            reset_llama_abort_state(KG_STORAGE.llm)
            raise mm.InterruptProcessingException() from err
        raise
    finally:
        stop_monitor.set()
        watchdog.join(timeout=0.5)
        if mm.processing_interrupted() or aborted_by_watchdog.is_set():
            reset_llama_abort_state(KG_STORAGE.llm)
            raise mm.InterruptProcessingException()


def _normalize_seed(seed_value) -> int:
    try:
        seed = int(seed_value)
    except (TypeError, ValueError):
        return 0
    if seed < 0 or seed > 0xFFFFFFFFFFFFFFFF:
        return 0
    return seed


def _strip_think(text: str) -> str:
    return strip_think_block(text or "")


def _scale_image_to_max_edge(pil: Image.Image, max_edge: int) -> Image.Image:
    max_edge = max(64, int(max_edge))
    width, height = pil.size
    longest = max(width, height)
    if longest <= max_edge:
        return pil
    scale = max_edge / float(longest)
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return pil.resize(new_size, Image.LANCZOS)


def _local_image_to_data_uri(image_path: str, max_edge: int) -> str:
    with Image.open(image_path) as pil:
        pil = _scale_image_to_max_edge(pil.convert("RGB"), max_edge)
        buffer = io.BytesIO()
        pil.save(buffer, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# 对话数据解析
# ---------------------------------------------------------------------------

def _normalize_image_ref(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    filename = os.path.basename(str(item.get("filename") or item.get("name") or "").strip())
    subfolder = str(item.get("subfolder") or "").replace("\\", "/").strip("/")
    image_type = str(item.get("type") or "input").strip().lower()
    if not filename or image_type != "input":
        return None
    if subfolder and any(part in ("", ".", "..") for part in subfolder.split("/")):
        return None
    return {"filename": filename, "subfolder": subfolder, "type": "input"}


def _parse_image_list(raw_images) -> list:
    if isinstance(raw_images, str):
        if not raw_images.strip():
            return []
        try:
            raw_images = json.loads(raw_images)
        except json.JSONDecodeError as exc:
            raise ValueError(f"待发送图片数据损坏，无法解析：{exc}") from exc
    if not isinstance(raw_images, list):
        return []

    images = []
    for item in raw_images:
        normalized = _normalize_image_ref(item)
        if normalized is not None:
            images.append(normalized)
    return images


def _parse_history(raw_history: str) -> list:
    if not raw_history or not raw_history.strip():
        return []

    try:
        data = json.loads(raw_history)
    except json.JSONDecodeError as exc:
        raise ValueError(f"对话历史数据损坏，无法解析：{exc}") from exc

    if not isinstance(data, list):
        raise ValueError("对话历史格式无效，应为消息列表。请在节点中清空会话后重试。")

    history = []
    for item in data:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            message = {"role": role, "content": content}
            images = _parse_image_list(item.get("images")) if role == "user" else []
            if images:
                message["images"] = images
            try:
                token_count = int(item.get("token_count"))
            except (TypeError, ValueError):
                token_count = -1
            if token_count >= 0:
                message["token_count"] = token_count
            try:
                created_at = int(item.get("created_at"))
            except (TypeError, ValueError):
                created_at = 0
            if created_at > 0:
                message["created_at"] = created_at
            if role == "assistant" and isinstance(item.get("flow_before"), dict):
                flow_before = item["flow_before"]
                message["flow_before"] = {
                    "skill": str(flow_before.get("skill") or ""),
                    "skill_name": str(flow_before.get("skill_name") or "")[:80],
                    "inline_file_id": str(flow_before.get("inline_file_id") or "")[:32],
                    "stage": str(flow_before.get("stage") or "未开始")[:40],
                    "loaded_references": [
                        str(reference)
                        for reference in flow_before.get("loaded_references", [])
                        if isinstance(reference, str)
                    ],
                    "final_result": str(flow_before.get("final_result") or ""),
                }
            history.append(message)

    return history


def _trim_history_by_rounds(history: list, max_rounds: int) -> list:
    max_messages = max(1, int(max_rounds)) * 2
    trimmed = history[-max_messages:]
    while trimmed and trimmed[0]["role"] == "assistant":
        trimmed.pop(0)
    return trimmed


def _estimate_text_tokens(llm, text: str) -> int:
    if not text:
        return 0
    try:
        return len(llm.tokenize(text.encode("utf-8"), add_bos=False))
    except Exception:
        return max(1, len(text.encode("utf-8")) // 3)


def _estimate_message_tokens(llm, message: dict) -> int:
    return (
        _estimate_text_tokens(llm, str(message.get("content") or ""))
        + 8
        + len(message.get("images") or []) * 2048
    )


def _estimate_messages_tokens(llm, messages: list) -> int:
    return sum(_estimate_message_tokens(llm, message) for message in messages) + 16


def _parse_request_time_ms(request_id: str) -> int:
    now_ms = int(time.time() * 1000)
    try:
        candidate = int(str(request_id or "").split("-", 1)[0])
    except (TypeError, ValueError):
        return now_ms
    if 946684800000 <= candidate <= now_ms + 300000:
        return candidate
    return now_ms


def _context_budget(max_tokens: int, n_ctx: int) -> tuple:
    output_reserve = min(max(32, int(max_tokens)), max(32, int(n_ctx) - 512))
    prompt_budget = max(256, int(n_ctx) - output_reserve - 128)
    return output_reserve, prompt_budget


def _trim_to_context(
    llm,
    history: list,
    system_text: str,
    user_text: str,
    max_tokens: int,
    n_ctx: int,
    current_image_count: int = 0,
) -> list:
    # 为模板控制符留出余量；历史始终按完整的一问一答从最旧处删除。
    _output_reserve, prompt_budget = _context_budget(max_tokens, n_ctx)

    prefix = []
    if system_text:
        prefix.append({"role": "system", "content": system_text})
    suffix = [{"role": "user", "content": user_text}]
    if current_image_count > 0:
        suffix[0]["images"] = [{}] * int(current_image_count)

    trimmed = list(history)
    while trimmed and _estimate_messages_tokens(llm, prefix + trimmed + suffix) > prompt_budget:
        trimmed.pop(0)
        if trimmed and trimmed[0]["role"] == "assistant":
            trimmed.pop(0)

    required_tokens = _estimate_messages_tokens(llm, prefix + trimmed + suffix)
    if required_tokens > prompt_budget:
        raise ValueError(
            f"当前系统提示词、Skill reference 和用户消息约需 {required_tokens} tokens，"
            f"超过可用输入上下文 {prompt_budget}。请提高模型上下文长度或使用更短的 Skill。"
        )

    return trimmed


def _build_context_state(
    llm,
    system_text: str,
    history: list,
    max_tokens: int,
    n_ctx: int,
    max_rounds: int,
    trimmed_messages: int = 0,
) -> dict:
    messages = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.extend(history)
    used_tokens = _estimate_messages_tokens(llm, messages)
    output_reserve, prompt_budget = _context_budget(max_tokens, n_ctx)
    percent = (used_tokens / prompt_budget * 100.0) if prompt_budget > 0 else 0.0
    return {
        "used_tokens": int(used_tokens),
        "prompt_budget": int(prompt_budget),
        "context_limit": int(n_ctx),
        "output_reserve": int(output_reserve),
        "remaining_tokens": max(0, int(prompt_budget) - int(used_tokens)),
        "percent": round(percent, 1),
        "trimmed_messages": max(0, int(trimmed_messages)),
        "current_rounds": sum(1 for message in history if message.get("role") == "user"),
        "max_rounds": max(1, int(max_rounds)),
        "estimated": True,
    }


def _extract_reply(result) -> str:
    try:
        content = result["choices"][0]["message"]["content"]
    except Exception:
        return str(result)

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def _image_ref_to_data_uri(image_ref: dict, max_edge: int) -> str:
    input_root = os.path.realpath(folder_paths.get_input_directory())
    image_path = os.path.realpath(
        os.path.join(input_root, image_ref.get("subfolder", ""), image_ref["filename"])
    )
    try:
        is_inside_input = os.path.commonpath([input_root, image_path]) == input_root
    except ValueError:
        is_inside_input = False
    if not is_inside_input:
        raise ValueError("图片路径超出 ComfyUI input 目录。")
    if not os.path.isfile(image_path):
        raise FileNotFoundError(f"找不到对话图片：{image_path}")
    return _local_image_to_data_uri(image_path, int(max_edge))


def _build_user_content(text: str, images: list, max_edge: int):
    if not images:
        return text
    content = [{"type": "text", "text": text}]
    for image_ref in images:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": _image_ref_to_data_uri(image_ref, max_edge)},
            }
        )
    return content


def _build_model_history(history: list, max_edge: int) -> list:
    messages = []
    for item in history:
        images = item.get("images") or []
        if item["role"] == "user" and images:
            messages.append({"role": "user", "content": _build_user_content(item["content"], images, max_edge)})
        else:
            messages.append({"role": item["role"], "content": item["content"]})
    return messages


# ---------------------------------------------------------------------------
# Skill 流程状态
# ---------------------------------------------------------------------------

def _default_flow_state() -> dict:
    return {
        "skill": "",
        "skill_name": "",
        "inline_file_id": "",
        "stage": "未开始",
        "loaded_references": [],
        "final_result": "",
    }


def _parse_flow_state(raw_state: str) -> dict:
    state = _default_flow_state()
    if raw_state and str(raw_state).strip():
        try:
            value = json.loads(raw_state)
        except json.JSONDecodeError:
            value = None
        if isinstance(value, dict):
            state["skill"] = str(value.get("skill") or "")
            state["skill_name"] = str(value.get("skill_name") or "")[:80]
            state["inline_file_id"] = str(value.get("inline_file_id") or "")[:32]
            state["stage"] = str(value.get("stage") or "未开始")[:40]
            state["loaded_references"] = [
                str(item) for item in value.get("loaded_references", []) if isinstance(item, str)
            ]
            state["final_result"] = str(value.get("final_result") or "")
    if state["skill"] and not state["skill_name"]:
        skill = get_skill(state["skill"])
        if skill is not None:
            state["skill_name"] = skill["name"]
    return state


def _parse_skill_reply(reply: str) -> tuple:
    matches = list(SKILL_STATE_TAG.finditer(reply or ""))
    if not matches:
        return (reply or "").strip(), {}
    match = matches[-1]
    try:
        state = json.loads(match.group(1))
    except json.JSONDecodeError:
        return SKILL_STATE_TAG.sub("", reply).strip(), {}
    if not isinstance(state, dict):
        state = {}
    text = (reply[: match.start()] + reply[match.end():]).strip()
    return text, state


def _normalize_options(value) -> list:
    if not isinstance(value, list):
        return []
    options = []
    for item in value[:6]:
        text = str(item or "").strip()
        if text:
            options.append(text[:240])
    return options


def _parse_options_json(raw_options: str) -> list:
    try:
        return _normalize_options(json.loads(raw_options or "[]"))
    except json.JSONDecodeError:
        return []


def _build_return(
    history: list,
    reply: str,
    final_result: str = "",
    flow_state: dict | None = None,
    options=None,
    sent: bool = False,
    context_state: dict | None = None,
):
    history_json = json.dumps(history, ensure_ascii=False, separators=(",", ":"))
    state = flow_state or _default_flow_state()
    ui = {
        "对话历史JSON": [history_json],
        "助手回复": [reply],
        "流程状态JSON": [json.dumps(state, ensure_ascii=False, separators=(",", ":"))],
        "流程阶段": [state.get("stage", "未开始")],
        "选项JSON": [json.dumps(_normalize_options(options), ensure_ascii=False)],
        "已发送": [bool(sent)],
    }
    if context_state is not None:
        ui["上下文状态JSON"] = [json.dumps(context_state, ensure_ascii=False, separators=(",", ":"))]
    return {
        "ui": ui,
        "result": (),
    }


def _auto_select_skill(llm, skills: list, user_text: str) -> str:
    if not skills:
        raise ValueError("Skill加载器没有发现可用 Skill，请把 Skill 放入插件的 skills 目录。")
    catalogue = "\n".join(
        f'- {item["id"]}: {item["name"]}；{item["description"][:500]}' for item in skills
    )
    messages = [
        {
            "role": "system",
            "content": "根据用户任务选择唯一最匹配的 Skill。只输出 Skill ID，不解释，不添加标点。",
        },
        {"role": "user", "content": f"可用 Skills：\n{catalogue}\n\n用户任务：\n{user_text}"},
    ]
    reset_llama_abort_state(llm)
    result = _call_chat_completion(
        llm,
        messages=messages,
        params={"max_tokens": 80, "temperature": 0.0, "top_p": 1.0, "top_k": 1, "seed": 0, "stream": False},
    )
    selected = _strip_think(_extract_reply(result)).strip().strip("`'\".,，。 ")
    valid_ids = {item["id"] for item in skills}
    if selected in valid_ids:
        return selected
    for skill_id in valid_ids:
        if skill_id in selected:
            return skill_id
    raise ValueError(f"自动选择 Skill 失败，模型返回：{selected[:120]}。请在 Skill加载器中手动选择。")


def _build_skill_system_prompt(base_system: str, skill: dict, flow_state: dict) -> str:
    loaded = []
    for relative_path in flow_state["loaded_references"]:
        if relative_path not in skill["references"]:
            continue
        loaded.append(f"\n\n===== reference: {relative_path} =====\n{read_reference(skill, relative_path)}")
    catalogue = "\n".join(f"- {path}" for path in skill["references"]) or "- 无"
    loaded_names = "、".join(flow_state["loaded_references"]) or "无"
    parts = [base_system.strip()]
    parts.append(
        f"当前 Skill：{skill['name']} ({skill['id']})\n"
        f"当前流程阶段：{flow_state['stage']}\n"
        f"可用 references：\n{catalogue}\n"
        f"已加载 references：{loaded_names}\n\n"
        f"===== {skill['skill_file']} =====\n{read_skill_body(skill)}"
    )
    parts.extend(loaded)
    parts.append(SKILL_EXECUTION_PROTOCOL)
    return "\n\n".join(part for part in parts if part)


def _build_inline_skill_system_prompt(base_system: str, inline_file: dict) -> str:
    return build_inline_skill_system_prompt(
        base_system,
        inline_file.get("name") or "loaded_skill.txt",
        inline_file.get("content") or "",
        SKILL_EXECUTION_PROTOCOL,
    )


def _sync_model(llama_model):
    """确保 KG_STORAGE 里加载的模型与工作流中的加载器配置一致。"""
    if not isinstance(llama_model, dict):
        raise RuntimeError("请先用『KG Llama Model加载器』连接模型。")
    if not KG_STORAGE.llm or KG_STORAGE.current_config != llama_model:
        KG_STORAGE.load_model(llama_model)
    if KG_STORAGE.llm is None:
        raise RuntimeError("模型加载失败，请检查模型文件。")
    return llama_model


def _default_chat_settings() -> dict:
    return {
        "系统提示词": DEFAULT_CHAT_SYSTEM_PROMPT,
        "最大历史轮数": 100,
        "最大生成token": 1024,
        "温度": 0.7,
        "top_p": 0.9,
        "top_k": 20,
        "重复惩罚": 1.0,
        "频率惩罚": 0.0,
        "存在惩罚": 0.0,
        "seed": 0,
        "输出think块": False,
        "最大边长": 1024,
    }


class kg_chat_settings:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "系统提示词": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "placeholder": "可选。连接 Skill 时由 Skill 负责系统规则。",
                    },
                ),
                "最大历史轮数": ("INT", {"default": 100, "min": 1, "max": 100, "step": 1}),
                "最大生成token": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 20,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "step": 1,
                        "tooltip": "界面不限制上限，实际长度受模型上下文长度约束。",
                    },
                ),
                "温度": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 2.0, "step": 0.01}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 20, "min": 0, "max": 200, "step": 1}),
                "重复惩罚": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.01}),
                "频率惩罚": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 2.0, "step": 0.01}),
                "存在惩罚": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 2.0, "step": 0.01}),
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "step": 1,
                        "control_after_generate": True,
                    },
                ),
                "输出think块": ("BOOLEAN", {"default": False}),
                "最大边长": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 128,
                        "max": 16384,
                        "step": 64,
                        "tooltip": "对话中插入的图片按最长边缩放。",
                    },
                ),
            }
        }

    RETURN_TYPES = ("KG_CHAT_SETTINGS",)
    RETURN_NAMES = ("增强设置",)
    FUNCTION = "run"
    CATEGORY = "llamacpp-kg"

    def run(
        self,
        系统提示词,
        最大历史轮数,
        最大生成token,
        温度,
        top_p,
        top_k,
        重复惩罚,
        频率惩罚,
        存在惩罚,
        seed,
        输出think块,
        最大边长,
    ):
        return (
            {
                "系统提示词": str(系统提示词 or ""),
                "最大历史轮数": int(最大历史轮数),
                "最大生成token": int(最大生成token),
                "温度": float(温度),
                "top_p": float(top_p),
                "top_k": int(top_k),
                "重复惩罚": float(重复惩罚),
                "频率惩罚": float(频率惩罚),
                "存在惩罚": float(存在惩罚),
                "seed": _normalize_seed(seed),
                "输出think块": bool(输出think块),
                "最大边长": int(最大边长),
            },
        )


class kg_multi_turn_chat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "llama_model": ("KGMODEL",),
                "用户消息": ("STRING", {"default": "", "multiline": True}),
                "对话历史JSON": ("STRING", {"default": "[]", "multiline": True}),
                "请求ID": ("STRING", {"default": ""}),
                "当前图片JSON": ("STRING", {"default": "[]", "multiline": True}),
                "流程状态JSON": ("STRING", {"default": "{}", "multiline": True}),
                "选项JSON": ("STRING", {"default": "[]", "multiline": True}),
            },
            "optional": {
                "增强设置": ("KG_CHAT_SETTINGS",),
                "skill加载器": ("KG_SKILL",),
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "run"
    CATEGORY = "llamacpp-kg"
    OUTPUT_NODE = True

    def run(
        self,
        llama_model,
        用户消息,
        对话历史JSON,
        请求ID,
        当前图片JSON,
        流程状态JSON="{}",
        选项JSON="[]",
        增强设置=None,
        skill加载器=None,
    ):
        request_created_at = _parse_request_time_ms(请求ID)
        settings = _default_chat_settings()
        if isinstance(增强设置, dict):
            settings.update({key: value for key, value in 增强设置.items() if key in settings})

        max_rounds = int(settings["最大历史轮数"])
        max_tokens = int(settings["最大生成token"])
        max_edge = int(settings["最大边长"])
        history = _trim_history_by_rounds(_parse_history(对话历史JSON), max_rounds)
        current_images = _parse_image_list(当前图片JSON)
        user_text = (用户消息 or "").strip()
        flow_state = _parse_flow_state(流程状态JSON)
        flow_state_before = {
            **flow_state,
            "loaded_references": list(flow_state["loaded_references"]),
        }

        if not user_text:
            last_reply = next(
                (item["content"] for item in reversed(history) if item["role"] == "assistant"),
                "",
            )
            return _build_return(
                history,
                last_reply,
                flow_state.get("final_result", ""),
                flow_state,
                _parse_options_json(选项JSON),
            )

        llama_model = _sync_model(llama_model)
        llm = KG_STORAGE.llm
        for history_item in history:
            if "token_count" not in history_item:
                history_item["token_count"] = _estimate_message_tokens(llm, history_item)
        system_text = str(settings["系统提示词"] or "").strip()
        skill = None
        if isinstance(skill加载器, dict):
            selected_id = str(skill加载器.get("selected") or "").strip()
            inline_file = skill加载器.get("inline_file")
            if isinstance(inline_file, dict) and str(inline_file.get("content") or "").strip():
                inline_file_id = str(inline_file.get("id") or "").strip()
                if flow_state.get("skill") or flow_state.get("inline_file_id") != inline_file_id:
                    flow_state = _default_flow_state()
                flow_state["inline_file_id"] = inline_file_id
                flow_state["skill_name"] = str(inline_file.get("name") or "loaded_skill.txt")[:80]
                if system_text == DEFAULT_CHAT_SYSTEM_PROMPT:
                    system_text = ""
                system_text = _build_inline_skill_system_prompt(system_text, inline_file)
            else:
                if flow_state.get("inline_file_id"):
                    flow_state = _default_flow_state()
                if selected_id and flow_state.get("skill") and flow_state["skill"] != selected_id:
                    flow_state = _default_flow_state()
                if selected_id:
                    flow_state["skill"] = selected_id
                    skill = get_skill(selected_id)
                elif not flow_state.get("skill"):
                    skill_id = _auto_select_skill(llm, skill加载器.get("skills") or [], user_text)
                    flow_state["skill"] = skill_id
                    skill = get_skill(skill_id)
                else:
                    skill = get_skill(flow_state["skill"])
                if skill is None:
                    raise ValueError("Skill 已不存在，请刷新 Skill加载器并重新选择。")
                flow_state["inline_file_id"] = ""
                flow_state["skill_name"] = skill["name"]
                if system_text == DEFAULT_CHAT_SYSTEM_PROMPT:
                    system_text = ""
                system_text = _build_skill_system_prompt(system_text, skill, flow_state)
        elif not system_text:
            system_text = DEFAULT_CHAT_SYSTEM_PROMPT

        has_mmproj = str((llama_model or {}).get("mmproj") or "None") not in ("", "None")
        history_image_count = sum(len(item.get("images") or []) for item in history)
        if (history_image_count or current_images) and not has_mmproj:
            raise RuntimeError("图片对话需要模型配置 mmproj 视觉投影，请在 KG Llama Model加载器中选择 mmproj 文件。")

        n_ctx = int((llama_model or {}).get("n_ctx") or 8192)
        history_before_context_trim = len(history)
        model_history = _trim_to_context(
            llm,
            history,
            system_text,
            user_text,
            max_tokens,
            n_ctx,
            current_image_count=len(current_images),
        )
        trimmed_message_count = history_before_context_trim - len(model_history)

        messages = []
        if system_text:
            messages.append({"role": "system", "content": system_text})
        messages.extend(_build_model_history(model_history, max_edge))
        messages.append({"role": "user", "content": _build_user_content(user_text, current_images, max_edge)})

        params = {
            "max_tokens": max_tokens,
            "temperature": float(settings["温度"]),
            "top_p": float(settings["top_p"]),
            "top_k": int(settings["top_k"]),
            "repeat_penalty": float(settings["重复惩罚"]),
            "frequency_penalty": float(settings["频率惩罚"]),
            "presence_penalty": float(settings["存在惩罚"]),
            "stream": False,
            "stop": ["</s>"],
        }

        reply = ""
        skill_state = {}
        for attempt in range(2):
            reset_llama_abort_state(llm)
            result = _chat_completion_with_abort(messages, _normalize_seed(settings["seed"]), params)
            raw_reply = _extract_reply(result)
            if not bool(settings["输出think块"]):
                raw_reply = _strip_think(raw_reply)
            reply, skill_state = _parse_skill_reply(raw_reply.lstrip().removeprefix(": ").strip())
            if skill is None:
                break
            requested = []
            for item in skill_state.get("load_references", []):
                if isinstance(item, str) and item in skill["references"] and item not in flow_state["loaded_references"]:
                    requested.append(item)
            if not requested or attempt == 1:
                break
            flow_state["loaded_references"].extend(requested)
            system_text = _build_skill_system_prompt(str(settings["系统提示词"] or "").strip(), skill, flow_state)
            history_before_reference_trim = len(model_history)
            model_history = _trim_to_context(
                llm,
                model_history,
                system_text,
                user_text,
                max_tokens,
                n_ctx,
                current_image_count=len(current_images),
            )
            trimmed_message_count += history_before_reference_trim - len(model_history)
            messages = [{"role": "system", "content": system_text}]
            messages.extend(_build_model_history(model_history, max_edge))
            messages.append({"role": "user", "content": _build_user_content(user_text, current_images, max_edge)})

        if mm.processing_interrupted():
            reset_llama_abort_state(llm)
            raise mm.InterruptProcessingException()

        user_history_item = {
            "role": "user",
            "content": user_text,
            "created_at": request_created_at,
        }
        if current_images:
            user_history_item["images"] = current_images
        user_history_item["token_count"] = _estimate_message_tokens(llm, user_history_item)
        assistant_history_item = {
            "role": "assistant",
            "content": reply,
            "flow_before": flow_state_before,
            "token_count": _estimate_message_tokens(llm, {"role": "assistant", "content": reply}),
            "created_at": int(time.time() * 1000),
        }
        for history_item in history:
            history_item.pop("flow_before", None)
        history.extend(
            [
                user_history_item,
                assistant_history_item,
            ]
        )
        history = _trim_history_by_rounds(history, max_rounds)
        if skill is not None:
            flow_state["stage"] = str(skill_state.get("stage") or flow_state.get("stage") or "进行中")[:40]
            options = _normalize_options(skill_state.get("options"))
            if bool(skill_state.get("final")):
                flow_state["final_result"] = reply
            final_result = flow_state.get("final_result", "")
        else:
            options = []
            final_result = ""
        context_history = model_history + [user_history_item, assistant_history_item]
        context_state = _build_context_state(
            llm,
            system_text,
            context_history,
            max_tokens,
            n_ctx,
            max_rounds,
            trimmed_messages=trimmed_message_count,
        )
        context_state["current_rounds"] = sum(
            1 for message in history if message.get("role") == "user"
        )
        return _build_return(
            history,
            reply,
            final_result,
            flow_state,
            options,
            sent=True,
            context_state=context_state,
        )
