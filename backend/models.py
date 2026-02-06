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
