"""
Crée un fichier .docx annoté avec des commentaires Word et des tracked changes (suivi de modifications).
Utilise python-docx + lxml pour injecter les commentaires et révisions dans le XML du document.
"""

import io
import copy
import re
from datetime import datetime
from typing import Optional

from docx import Document
from docx.opc.part import Part
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml.ns import qn, nsmap
from lxml import etree


# Namespace pour les commentaires Word
WML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
COMMENTS_URI = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"


def _create_comment_element(comment_id: int, author: str, text: str, date_str: str) -> etree._Element:
    """Crée un élément <w:comment> pour comments.xml."""
    comment = etree.SubElement(etree.Element("dummy"), qn("w:comment"))
    comment.set(qn("w:id"), str(comment_id))
    comment.set(qn("w:author"), author)
    comment.set(qn("w:date"), date_str)
    comment.set(qn("w:initials"), author[:2].upper())

    # Découper le texte du commentaire en paragraphes
    paragraphs = text.strip().split("\n")
    for para_text in paragraphs:
        para_text = para_text.strip()
        if not para_text:
            continue
        p = etree.SubElement(comment, qn("w:p"))
        r = etree.SubElement(p, qn("w:r"))
        t = etree.SubElement(r, qn("w:t"))
        t.set(qn("xml:space"), "preserve")
        t.text = para_text

    return comment


def _add_comment_to_paragraph(para_element: etree._Element, comment_id: int):
    """Ajoute les marqueurs de commentaire (rangeStart, rangeEnd, reference) autour du contenu d'un paragraphe."""
    # Créer commentRangeStart
    range_start = etree.Element(qn("w:commentRangeStart"))
    range_start.set(qn("w:id"), str(comment_id))

    # Créer commentRangeEnd
    range_end = etree.Element(qn("w:commentRangeEnd"))
    range_end.set(qn("w:id"), str(comment_id))

    # Créer le run avec commentReference
    ref_run = etree.Element(qn("w:r"))
    ref_rpr = etree.SubElement(ref_run, qn("w:rPr"))
    ref_style = etree.SubElement(ref_rpr, qn("w:rStyle"))
    ref_style.set(qn("w:val"), "CommentReference")
    ref_elem = etree.SubElement(ref_run, qn("w:commentReference"))
    ref_elem.set(qn("w:id"), str(comment_id))

    # Insérer rangeStart avant le premier run, rangeEnd + reference après le dernier run
    runs = para_element.findall(qn("w:r"))
    if runs:
        runs[0].addprevious(range_start)
        runs[-1].addnext(range_end)
        range_end.addnext(ref_run)
    else:
        para_element.insert(0, range_start)
        para_element.append(range_end)
        para_element.append(ref_run)


def _add_tracked_change_to_paragraph(para_element: etree._Element, rewrite_text: str, author: str, date_str: str, revision_id: int):
    """Ajoute un tracked change (suppression de l'original + insertion de la réécriture) au paragraphe.
    
    Le texte original de tous les runs est enveloppé dans <w:del>,
    et le texte de réécriture est ajouté dans <w:ins> juste après.
    L'utilisateur peut ensuite accepter ou refuser chaque modification dans Word.
    """
    # Collecter tous les runs existants
    runs = para_element.findall(qn("w:r"))
    if not runs:
        return

    # Trouver le dernier run (on va insérer après lui)
    last_run = runs[-1]

    # Créer le bloc <w:del> qui enveloppe les runs originaux
    # On marque chaque run original comme supprimé
    for run in runs:
        # Vérifier si ce run contient du texte (pas un commentReference)
        t_elems = run.findall(qn("w:t"))
        if not t_elems:
            continue
        
        # Créer un w:del wrapper
        del_elem = etree.Element(qn("w:del"))
        del_elem.set(qn("w:id"), str(revision_id))
        del_elem.set(qn("w:author"), author)
        del_elem.set(qn("w:date"), date_str)
        
        # Cloner le run pour le mettre dans le del
        del_run = copy.deepcopy(run)
        # Renommer les w:t en w:delText
        for t in del_run.findall(qn("w:t")):
            t.tag = qn("w:delText")
            t.set(qn("xml:space"), "preserve")
        
        del_elem.append(del_run)
        
        # Remplacer le run original par le del
        run.addprevious(del_elem)
        run.getparent().remove(run)
        
        revision_id += 1

    # Créer le bloc <w:ins> avec le texte de réécriture
    ins_elem = etree.Element(qn("w:ins"))
    ins_elem.set(qn("w:id"), str(revision_id))
    ins_elem.set(qn("w:author"), author)
    ins_elem.set(qn("w:date"), date_str)
    
    ins_run = etree.SubElement(ins_elem, qn("w:r"))
    # Copier les propriétés de formatage du premier run original si possible
    if runs[0].find(qn("w:rPr")) is not None:
        ins_run.append(copy.deepcopy(runs[0].find(qn("w:rPr"))))
    ins_t = etree.SubElement(ins_run, qn("w:t"))
    ins_t.set(qn("xml:space"), "preserve")
    ins_t.text = rewrite_text

    # Insérer le bloc ins à la fin du paragraphe (avant les éventuels commentRangeEnd)
    range_ends = para_element.findall(qn("w:commentRangeEnd"))
    if range_ends:
        range_ends[0].addprevious(ins_elem)
    else:
        # Insérer après le dernier del
        dels = para_element.findall(qn("w:del"))
        if dels:
            dels[-1].addnext(ins_elem)
        else:
            para_element.append(ins_elem)

    return revision_id + 1


def _find_paragraph_containing(doc: Document, search_text: str) -> Optional[int]:
    """Trouve l'index du premier paragraphe contenant le texte recherché."""
    search_lower = search_text.lower().strip()
    # Essayer d'abord une correspondance exacte
    for i, para in enumerate(doc.paragraphs):
        if search_lower in para.text.lower():
            return i
    return None


def _normalize_text(text: str) -> str:
    """Normalise le texte pour la comparaison (espaces multiples, etc.)."""
    return re.sub(r'\s+', ' ', text.strip().lower())


def _find_best_paragraph(doc: Document, search_text: str) -> Optional[int]:
    """Trouve le meilleur paragraphe correspondant au texte recherché.
    Essaie d'abord une correspondance exacte, puis une correspondance partielle."""
    if not search_text or not search_text.strip():
        return None

    search_norm = _normalize_text(search_text)

    # 1) Correspondance exacte (texte contenu dans le paragraphe)
    for i, para in enumerate(doc.paragraphs):
        para_norm = _normalize_text(para.text)
        if not para_norm:
            continue
        if search_norm in para_norm:
            return i

    # 2) Le paragraphe est contenu dans le texte recherché (extrait long)
    for i, para in enumerate(doc.paragraphs):
        para_norm = _normalize_text(para.text)
        if not para_norm or len(para_norm) < 20:
            continue
        if para_norm in search_norm:
            return i

    # 3) Correspondance par mots-clés (au moins 60% des mots significatifs)
    search_words = set(w for w in search_norm.split() if len(w) > 3)
    if search_words:
        best_ratio = 0
        best_idx = None
        for i, para in enumerate(doc.paragraphs):
            para_norm = _normalize_text(para.text)
            if not para_norm or len(para_norm) < 10:
                continue
            para_words = set(w for w in para_norm.split() if len(w) > 3)
            if not para_words:
                continue
            common = search_words & para_words
            ratio = len(common) / len(search_words)
            if ratio > best_ratio and ratio >= 0.5:
                best_ratio = ratio
                best_idx = i
        return best_idx

    return None


def build_commented_docx(
    original_bytes: bytes,
    comments: list[dict],
    author: str = "Reviewer",
    ext: str = "docx",
) -> bytes:
    """
    Prend un document original et une liste de commentaires, retourne un .docx avec commentaires Word.

    comments: [{"passage": "texte à trouver", "comment": "commentaire"}, ...]
    """
    if ext in ("docx", "doc"):
        doc = Document(io.BytesIO(original_bytes))
    else:
        # Convertir l'ODT en DOCX via LibreOffice (conserve images, styles, mise en page)
        docx_bytes_converted = _convert_odt_to_docx(original_bytes)
        doc = Document(io.BytesIO(docx_bytes_converted))

    if not comments:
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    # Créer l'élément racine comments.xml
    RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    comments_root = etree.Element(
        qn("w:comments"),
        nsmap={"w": WML_NS, "r": RELS_NS},
    )

    date_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    comment_id = 0
    revision_id = 1000  # IDs pour les tracked changes (séparés des comment IDs)
    used_paragraphs = set()

    for item in comments:
        passage = item.get("passage", "").strip()
        comment_text = item.get("comment", "").strip()
        rewrite_text = item.get("rewrite", "").strip()
        if not comment_text:
            continue

        # Trouver le paragraphe correspondant
        para_idx = _find_best_paragraph(doc, passage)

        # Si on n'a pas trouvé avec le passage, essayer avec le début du commentaire
        if para_idx is None and passage:
            first_words = " ".join(passage.split()[:5])
            para_idx = _find_best_paragraph(doc, first_words)

        if para_idx is None:
            continue

        # Éviter de commenter le même paragraphe deux fois
        original_idx = para_idx
        while para_idx in used_paragraphs and para_idx < len(doc.paragraphs) - 1:
            para_idx += 1
        if para_idx in used_paragraphs:
            para_idx = original_idx

        used_paragraphs.add(para_idx)

        # Ajouter le commentaire XML (bulle)
        comment_elem = _create_comment_element(comment_id, author, comment_text, date_str)
        comments_root.append(comment_elem)

        # Ajouter les marqueurs de commentaire au paragraphe
        para_element = doc.paragraphs[para_idx]._element
        _add_comment_to_paragraph(para_element, comment_id)

        # Si une réécriture est proposée, ajouter un tracked change (suivi de modifications)
        if rewrite_text:
            new_rev_id = _add_tracked_change_to_paragraph(
                para_element, rewrite_text, author, date_str, revision_id
            )
            if new_rev_id:
                revision_id = new_rev_id

        comment_id += 1

    if comment_id == 0:
        # Aucun commentaire n'a pu être placé
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    # Sauvegarder le document dans un buffer
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    # Injecter comments.xml dans le package .docx (qui est un zip)
    import zipfile
    from io import BytesIO

    original_zip = zipfile.ZipFile(buf, 'r')

    # Lire le rels existant et le modifier AVANT d'écrire le zip final
    rels_path = "word/_rels/document.xml.rels"
    if rels_path in [i.filename for i in original_zip.infolist()]:
        rels_data = original_zip.read(rels_path)
    else:
        rels_data = (
            b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        )

    rels_tree = etree.fromstring(rels_data)
    rels_ns = "http://schemas.openxmlformats.org/package/2006/relationships"

    existing_rels = rels_tree.findall(f"{{{rels_ns}}}Relationship[@Type='{COMMENTS_URI}']")
    if not existing_rels:
        existing_ids = [r.get("Id", "") for r in rels_tree.findall(f"{{{rels_ns}}}Relationship")]
        max_id = 0
        for rid in existing_ids:
            if rid.startswith("rId"):
                try:
                    max_id = max(max_id, int(rid[3:]))
                except ValueError:
                    pass
        new_rid = f"rId{max_id + 1}"
        rel = etree.SubElement(rels_tree, f"{{{rels_ns}}}Relationship")
        rel.set("Id", new_rid)
        rel.set("Type", COMMENTS_URI)
        rel.set("Target", "comments.xml")

    updated_rels = etree.tostring(rels_tree, xml_declaration=True, encoding="UTF-8", standalone=True)

    # Construire le zip final en une seule passe
    output = BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as output_zip:
        for item_info in original_zip.infolist():
            data = original_zip.read(item_info.filename)

            if item_info.filename == "[Content_Types].xml":
                ct_tree = etree.fromstring(data)
                ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
                existing = ct_tree.findall(f"{{{ct_ns}}}Override[@PartName='/word/comments.xml']")
                if not existing:
                    override = etree.SubElement(ct_tree, f"{{{ct_ns}}}Override")
                    override.set("PartName", "/word/comments.xml")
                    override.set("ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml")
                data = etree.tostring(ct_tree, xml_declaration=True, encoding="UTF-8", standalone=True)

            elif item_info.filename == rels_path:
                data = updated_rels

            output_zip.writestr(item_info, data)

        # Ajouter comments.xml
        comments_xml = etree.tostring(comments_root, xml_declaration=True, encoding="UTF-8", standalone=True)
        output_zip.writestr("word/comments.xml", comments_xml)

        # Si le rels n'existait pas dans le zip original, l'ajouter
        if rels_path not in [i.filename for i in original_zip.infolist()]:
            output_zip.writestr(rels_path, updated_rels)

    original_zip.close()
    output.seek(0)
    return output.getvalue()


def _convert_odt_to_docx(odt_bytes: bytes) -> bytes:
    """Convertit un fichier ODT en DOCX via LibreOffice (conserve images, styles, mise en page)."""
    import subprocess
    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmpdir:
        odt_path = os.path.join(tmpdir, "input.odt")
        with open(odt_path, "wb") as f:
            f.write(odt_bytes)

        # Conversion via LibreOffice headless
        result = subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "docx", "--outdir", tmpdir, odt_path],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"[odt→docx] LibreOffice stderr: {result.stderr}")
            raise RuntimeError(f"Échec de la conversion ODT→DOCX : {result.stderr}")

        docx_path = os.path.join(tmpdir, "input.docx")
        if not os.path.exists(docx_path):
            raise RuntimeError("Le fichier DOCX converti n'a pas été créé par LibreOffice")

        with open(docx_path, "rb") as f:
            return f.read()
