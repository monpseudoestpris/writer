"""
Import de documents .docx et .odt : extraction du titre et découpage en chapitres
selon les titres de plus haut niveau trouvés dans le document.
"""

import html as html_module
import io
import os
import tempfile
from typing import Optional


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------

def parse_docx(file_bytes: bytes) -> dict:
    """Parse un fichier .docx et retourne {title, chapters: [{title, content}]}."""
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(io.BytesIO(file_bytes))

    # Titre depuis les métadonnées du document
    title = (doc.core_properties.title or "").strip() or None

    elements: list[dict] = []

    # Parcourir TOUS les éléments du body XML (pas seulement doc.paragraphs)
    # pour capturer les paragraphes dans des sections structurées
    body = doc.element.body
    for child in body:
        tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag

        if tag == "p":
            # C'est un paragraphe
            para = _find_paragraph_by_element(doc, child)
            if para is None:
                continue

            style_name = para.style.name if para.style else ""
            heading_level = _detect_heading_level_docx(para, style_name)
            html_content = _runs_to_html(para.runs)
            plain_text = para.text.strip()

            if plain_text:
                elements.append({
                    "heading_level": heading_level,
                    "text": plain_text,
                    "html": html_content,
                })

        elif tag == "tbl":
            # Table : extraire le texte de chaque cellule
            for row in child.findall(qn("w:tr")):
                for cell in row.findall(qn("w:tc")):
                    for p_elem in cell.findall(qn("w:p")):
                        para = _find_paragraph_by_element(doc, p_elem)
                        if para and para.text.strip():
                            elements.append({
                                "heading_level": None,
                                "text": para.text.strip(),
                                "html": _runs_to_html(para.runs),
                            })

    return _split_by_headings(elements, title)


def _find_paragraph_by_element(doc, element):
    """Retrouve l'objet Paragraph python-docx correspondant à un élément XML."""
    from docx.text.paragraph import Paragraph
    try:
        return Paragraph(element, doc.element.body)
    except Exception:
        return None


def _detect_heading_level_docx(para, style_name: str) -> Optional[int]:
    """Détecte le niveau de titre d'un paragraphe .docx."""
    from docx.oxml.ns import qn

    # 1) Noms de styles standards (anglais et français)
    for prefix in ("Heading ", "Titre ", "heading ", "titre "):
        if style_name.startswith(prefix):
            try:
                return int(style_name[len(prefix):].strip())
            except ValueError:
                return 1

    # Styles spéciaux
    style_lower = style_name.lower()
    if style_lower in ("heading", "titre", "title", "heading1", "titre1"):
        return 1

    # Styles LibreOffice importés dans docx
    if style_lower.startswith("heading") and style_lower[-1].isdigit():
        try:
            return int(style_lower.replace("heading", "").strip())
        except ValueError:
            return 1

    # 2) Fallback : outline level dans le XML
    pPr = para._element.find(qn("w:pPr"))
    if pPr is not None:
        outlineLvl = pPr.find(qn("w:outlineLvl"))
        if outlineLvl is not None:
            val = outlineLvl.get(qn("w:val"))
            if val is not None:
                try:
                    return int(val) + 1  # XML 0-based → 1-based
                except ValueError:
                    pass

        # 3) Fallback : style référencé dans pStyle
        pStyle = pPr.find(qn("w:pStyle"))
        if pStyle is not None:
            style_id = pStyle.get(qn("w:val")) or ""
            style_id_lower = style_id.lower()
            for prefix in ("heading", "titre"):
                if style_id_lower.startswith(prefix):
                    rest = style_id_lower[len(prefix):]
                    if rest and rest[0].isdigit():
                        try:
                            return int(rest[0])
                        except ValueError:
                            pass
                    return 1

    return None


def _runs_to_html(runs) -> str:
    """Convertit les runs d'un paragraphe docx en HTML inline."""
    parts: list[str] = []
    for run in runs:
        text = html_module.escape(run.text or "")
        if not text:
            continue
        if run.bold:
            text = f"<strong>{text}</strong>"
        if run.italic:
            text = f"<em>{text}</em>"
        if run.underline:
            text = f"<u>{text}</u>"
        parts.append(text)
    return "".join(parts)


# ---------------------------------------------------------------------------
# ODT
# ---------------------------------------------------------------------------

def parse_odt(file_bytes: bytes) -> dict:
    """Parse un fichier .odt et retourne {title, chapters: [{title, content}]}."""
    from odf.opendocument import load as odf_load
    from odf import teletype
    from odf.namespaces import TEXTNS, DCNS

    # odfpy a besoin d'un fichier sur disque
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".odt")
        os.write(fd, file_bytes)
        os.close(fd)
        doc = odf_load(tmp_path)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # Titre depuis les métadonnées
    title = None
    if doc.meta:
        for child in doc.meta.childNodes:
            qname = getattr(child, "qname", None)
            if qname == (DCNS, "title"):
                title = (teletype.extractText(child) or "").strip() or None
                break

    TEXT_H = (TEXTNS, "h")
    TEXT_P = (TEXTNS, "p")

    # Nœuds "feuilles" qu'on extrait directement (pas de descente récursive)
    LEAF_NODES = {TEXT_H, TEXT_P}

    elements: list[dict] = []
    in_list_depth = 0  # pour détecter si on est dans une liste

    def _walk_odt_nodes(node):
        """Parcours récursif générique : extrait les h et p, descend dans tout le reste."""
        nonlocal in_list_depth

        for child in node.childNodes:
            qname = getattr(child, "qname", None)
            if qname is None:
                continue

            if qname == TEXT_H:
                text_content = teletype.extractText(child).strip()
                outline_level_str = child.getAttrNS(TEXTNS, "outline-level") or "1"
                try:
                    level = int(outline_level_str)
                except ValueError:
                    level = 1

                if text_content:
                    elements.append({
                        "heading_level": level,
                        "text": text_content,
                        "html": _odt_inline_to_html(child),
                    })

            elif qname == TEXT_P:
                text_content = teletype.extractText(child).strip()
                if text_content:
                    prefix = "• " if in_list_depth > 0 else ""
                    html_prefix = "• " if in_list_depth > 0 else ""
                    elements.append({
                        "heading_level": None,
                        "text": prefix + text_content,
                        "html": html_prefix + _odt_inline_to_html(child),
                    })

            else:
                # Tout autre conteneur : descendre récursivement
                is_list = (qname == (TEXTNS, "list"))
                if is_list:
                    in_list_depth += 1
                has_children = hasattr(child, "childNodes") and len(child.childNodes) > 0
                if has_children:
                    _walk_odt_nodes(child)
                if is_list:
                    in_list_depth -= 1

    _walk_odt_nodes(doc.text)

    return _split_by_headings(elements, title)


def _odt_inline_to_html(node) -> str:
    """Convertit un nœud ODT (paragraphe/heading) en HTML avec gras/italique."""
    from odf import teletype
    from odf.namespaces import TEXTNS

    TEXT_SPAN = (TEXTNS, "span")
    parts: list[str] = []

    for child in node.childNodes:
        qname = getattr(child, "qname", None)

        if qname is None:
            # Nœud texte brut
            text = str(child)
            if text:
                parts.append(html_module.escape(text))

        elif qname == TEXT_SPAN:
            text = teletype.extractText(child).strip()
            if not text:
                continue
            escaped = html_module.escape(text)

            # Détecter gras/italique via le style
            style_name = child.getAttrNS(TEXTNS, "style-name") or ""
            style_lower = style_name.lower()
            if "bold" in style_lower or "gras" in style_lower:
                escaped = f"<strong>{escaped}</strong>"
            elif "italic" in style_lower or "italique" in style_lower:
                escaped = f"<em>{escaped}</em>"

            parts.append(escaped)
        else:
            # Autre élément inline : extraire le texte
            text = teletype.extractText(child)
            if text:
                parts.append(html_module.escape(text))

    return "".join(parts) or html_module.escape(teletype.extractText(node))


# ---------------------------------------------------------------------------
# Découpage commun
# ---------------------------------------------------------------------------

def _split_by_headings(elements: list[dict], title: Optional[str]) -> dict:
    """Découpe les éléments par le niveau de titre le plus élevé."""
    if not elements:
        return {"title": title, "chapters": []}

    # Trouver le niveau de titre le plus haut (plus petit numéro)
    heading_levels = [
        e["heading_level"] for e in elements if e["heading_level"] is not None
    ]

    if not heading_levels:
        # Aucun titre trouvé → un seul chapitre
        all_html = "\n".join(f'<p>{e["html"]}</p>' for e in elements)
        return {
            "title": title,
            "chapters": [{"title": "Chapitre 1", "content": all_html}],
        }

    split_level = min(heading_levels)

    chapters: list[dict] = []
    current_title: Optional[str] = None
    current_content: list[str] = []

    for elem in elements:
        if elem["heading_level"] == split_level:
            # Sauvegarder le chapitre précédent
            if current_title is not None or current_content:
                chapters.append({
                    "title": current_title or "Préambule",
                    "content": "\n".join(current_content),
                })
            current_title = elem["text"]
            current_content = []
        else:
            if elem["heading_level"] is not None:
                lvl = elem["heading_level"]
                current_content.append(f'<h{lvl}>{elem["html"]}</h{lvl}>')
            else:
                current_content.append(f'<p>{elem["html"]}</p>')

    # Dernier chapitre
    if current_title is not None or current_content:
        chapters.append({
            "title": current_title or "Sans titre",
            "content": "\n".join(current_content),
        })

    return {"title": title, "chapters": chapters}
