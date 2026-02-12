from pydantic import BaseModel
from typing import Optional

class ReviewRequest(BaseModel):
    text: str
    reviewer: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    previous_critiques: Optional[list[dict]] = None
    text_changed: bool = False

class ReviewResponse(BaseModel):
    reviewer: str
    critique: str
    suggestions: list[str]

class SummarizeRequest(BaseModel):
    critique: str

class DialogueRequest(BaseModel):
    text: str
    writer_profile: Optional[str] = None
    book_summary: Optional[str] = None
    chapter_summary: Optional[str] = None
    num_authors: int = 3

class WorldBuildingFeedbackRequest(BaseModel):
    entry_title: str
    entry_content: str
    category: str
    reviewer: Optional[str] = None
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None

class WorldBuildingAutoFillRequest(BaseModel):
    entry_title: str
    entry_content: Optional[str] = None
    category: str
    book_summary: Optional[str] = None
    all_entries_context: Optional[str] = None
