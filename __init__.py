# -*- coding: utf-8 -*-
"""Comfyui-llama-kg：基于 ComfyUI-llama-cpp_vlm (sthao42) 的 llama.cpp 节点集，
新增 Skill 加载与多轮对话（参考 comfyUI-llama-TE）。"""

from .nodes import NODE_CLASS_MAPPINGS as _KG_BASE_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS as _KG_BASE_DISPLAY
from .multi_turn_chat import kg_multi_turn_chat, kg_chat_settings
from .skill_loader import kg_skill_loader

NODE_CLASS_MAPPINGS = {
    **_KG_BASE_MAPPINGS,
    "kg_skill_loader": kg_skill_loader,
    "kg_chat_settings": kg_chat_settings,
    "kg_multi_turn_chat": kg_multi_turn_chat,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **_KG_BASE_DISPLAY,
    "kg_skill_loader": "KG Skill 加载器",
    "kg_chat_settings": "KG 对话增强设置",
    "kg_multi_turn_chat": "KG 多轮对话",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
