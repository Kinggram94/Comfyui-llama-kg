# -*- coding: utf-8 -*-
"""KG Skill 加载器：发现插件 skills 目录中的 Skill 文件，
并支持浏览器临时加载本地 .md/.txt 作为提示词（无需复制进 skills 目录）。

移植自 comfyUI-llama-TE 的 skill_loader，行为保持一致。
"""

import hashlib
import os
import re

SKILLS_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "skills")
AUTO_CHOICE = "自动选择"
MAX_INLINE_BYTES = 4 * 1024 * 1024
SKILL_FILE_EXTS = (".md", ".txt")
REFERENCE_EXTS = (".md", ".txt", ".yaml", ".yml", ".json")


def _read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8-sig") as handle:
        return handle.read()


def _parse_frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}

    values = {}
    lines = text[3:end].splitlines()
    index = 0
    while index < len(lines):
        match = re.match(r"^([\w-]+):\s*(.*)$", lines[index])
        if not match:
            index += 1
            continue
        key, value = match.groups()
        if value in ("|", ">"):
            index += 1
            parts = []
            while index < len(lines) and (not lines[index].strip() or lines[index][:1].isspace()):
                parts.append(lines[index].strip())
                index += 1
            values[key] = " ".join(part for part in parts if part)
            continue
        values[key] = value.strip().strip("\"'")
        index += 1
    return values


def _read_meta_value(skill_dir: str, key: str) -> str:
    path = os.path.join(skill_dir, "meta.yaml")
    if not os.path.isfile(path):
        return ""
    for line in _read_text(path).splitlines():
        match = re.match(rf"^{re.escape(key)}:\s*(.+?)\s*$", line)
        if match:
            return match.group(1).strip().strip("\"'")
    return ""


def _list_references(skill_dir: str) -> list:
    reference_dir = os.path.join(skill_dir, "references")
    if not os.path.isdir(reference_dir):
        return []
    files = []
    for root, _, names in os.walk(reference_dir):
        for name in names:
            if os.path.splitext(name)[1].lower() not in REFERENCE_EXTS:
                continue
            relative = os.path.relpath(os.path.join(root, name), skill_dir).replace("\\", "/")
            files.append(relative)
    return sorted(files)


def _build_skill_record(
    file_path: str,
    *,
    skill_id: str | None = None,
    skill_dir: str | None = None,
    legacy_label: bool = False,
) -> dict:
    """保留旧的目录型 Skill ID，保证已保存工作流的选择不失效。"""
    file_path = os.path.realpath(file_path)
    skill_dir = os.path.realpath(skill_dir or os.path.dirname(file_path))
    relative_file = os.path.relpath(file_path, SKILLS_DIR).replace("\\", "/")
    relative_dir = os.path.relpath(skill_dir, SKILLS_DIR).replace("\\", "/")
    if relative_dir == ".":
        relative_dir = ""

    content = _read_text(file_path)
    metadata = _parse_frontmatter(content)
    meta_name = _read_meta_value(skill_dir, "display-name-zh")
    meta_description = _read_meta_value(skill_dir, "summary-cn")
    fallback_name = os.path.splitext(os.path.basename(file_path))[0]
    name = meta_name or metadata.get("name") or fallback_name
    description = meta_description or metadata.get("description") or ""
    entry_id = skill_id or relative_file
    if legacy_label:
        label = f"{name} [{entry_id}]" if name != entry_id else entry_id
    else:
        label = f"{name} [{relative_file}]"
    return {
        "id": entry_id,
        "name": name,
        "label": label,
        "description": description,
        "skill_file": os.path.basename(file_path),
        "skill_path": relative_file,
        "skill_dir": relative_dir,
        "references": _list_references(skill_dir),
    }


def discover_skills() -> list:
    if not os.path.isdir(SKILLS_DIR):
        return []

    skills = []
    for root, dirnames, filenames in os.walk(SKILLS_DIR):
        # references 由所属 Skill 按需加载，不作为下拉选项出现。
        dirnames[:] = sorted(name for name in dirnames if name != "references")
        filenames = sorted(name for name in filenames if os.path.splitext(name)[1].lower() in SKILL_FILE_EXTS)
        if not filenames:
            continue

        relative_dir = os.path.relpath(root, SKILLS_DIR).replace("\\", "/")
        legacy_dir = relative_dir != "." and re.fullmatch(r"[A-Za-z0-9._-]+", relative_dir or "")
        default_name = "SKILL.md"
        chinese_name = "SKILL.cn.md"
        primary_name = chinese_name if chinese_name in filenames else default_name if default_name in filenames else None

        if legacy_dir and primary_name:
            skills.append(
                _build_skill_record(
                    os.path.join(root, primary_name),
                    skill_id=relative_dir,
                    skill_dir=root,
                    legacy_label=True,
                )
            )

        for filename in filenames:
            if filename in (default_name, chinese_name) and primary_name and legacy_dir:
                continue
            file_path = os.path.join(root, filename)
            relative_file = os.path.relpath(file_path, SKILLS_DIR).replace("\\", "/")
            skills.append(_build_skill_record(file_path, skill_id=relative_file, skill_dir=root))

    return sorted(skills, key=lambda item: (item["label"].casefold(), item["id"].casefold()))


def get_skill(skill_id: str) -> dict | None:
    return next((skill for skill in discover_skills() if skill["id"] == skill_id), None)


def read_skill_body(skill: dict) -> str:
    skill_path = skill.get("skill_path") or os.path.join(skill["id"], skill["skill_file"])
    return _read_text(os.path.join(SKILLS_DIR, skill_path))


def build_inline_skill_system_prompt(base_system: str, file_name: str, content: str, instruction: str = "") -> str:
    """把浏览器临时加载的 Markdown/TXT 文件包装成系统提示词。"""
    name = os.path.basename(str(file_name or "loaded_skill.txt")) or "loaded_skill.txt"
    text = str(content or "").strip()
    parts = [
        str(base_system or "").strip(),
        f"当前加载文件：{name}\n===== {name} =====\n{text}",
    ]
    if instruction:
        parts.append(str(instruction).strip())
    return "\n\n".join(part for part in parts if part)


def normalize_inline_file(file_name: str, content: str) -> dict | None:
    name = os.path.basename(str(file_name or "").strip())
    text = str(content or "")
    if not text.strip():
        return None
    if not name:
        name = "loaded_skill.txt"
    extension = os.path.splitext(name)[1].lower()
    if extension not in SKILL_FILE_EXTS:
        raise ValueError("加载 Skill/提示词只支持 .md 或 .txt 文件。")
    if len(text.encode("utf-8")) > MAX_INLINE_BYTES:
        raise ValueError("加载 Skill/提示词文件不能超过 4 MB。")
    file_id = hashlib.sha256((name + "\0" + text).encode("utf-8")).hexdigest()[:16]
    return {"name": name, "content": text, "source": "local_file", "id": file_id}


def read_reference(skill: dict, relative_path: str) -> str:
    normalized = str(relative_path or "").replace("\\", "/").strip("/")
    if normalized not in skill["references"]:
        raise ValueError(f"Skill reference 不存在：{normalized}")
    skill_dir_value = skill.get("skill_dir")
    skill_dir = os.path.realpath(
        os.path.join(SKILLS_DIR, skill_dir_value) if skill_dir_value else os.path.join(SKILLS_DIR, skill["id"])
    )
    path = os.path.realpath(os.path.join(skill_dir, normalized))
    if os.path.commonpath([skill_dir, path]) != skill_dir:
        raise ValueError("Skill reference 路径超出 Skill 目录。")
    return _read_text(path)


class kg_skill_loader:
    @classmethod
    def INPUT_TYPES(cls):
        choices = [AUTO_CHOICE] + [skill["label"] for skill in discover_skills()]
        return {
            "required": {
                "skill": (
                    choices,
                    {
                        "default": AUTO_CHOICE,
                        "tooltip": "自动选择会根据首次任务匹配 Skill；也可以固定选择一个 Skill。",
                    },
                ),
            },
            "hidden": {
                "skill_folder_path": SKILLS_DIR,
            },
            "optional": {
                # 由浏览器文件选择框写入；保持普通 widget 以便排队与保存工作流。
                "加载文件名": ("STRING", {"default": "", "multiline": False}),
                "加载文件内容": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("KG_SKILL",)
    RETURN_NAMES = ("skill加载器",)
    FUNCTION = "run"
    CATEGORY = "llamacpp-kg"

    def run(self, skill, 加载文件名="", 加载文件内容="", **kwargs):
        skills = discover_skills()
        selected = ""
        if skill != AUTO_CHOICE:
            selected_skill = next((item for item in skills if item["label"] == skill or item["id"] == skill), None)
            if selected_skill is None:
                raise ValueError(f"找不到 Skill：{skill}，请刷新节点后重新选择。")
            selected = selected_skill["id"]
        inline_file = normalize_inline_file(加载文件名, 加载文件内容)
        return ({"selected": selected, "skills": skills, "inline_file": inline_file},)
