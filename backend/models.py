from pydantic import BaseModel
from typing import Optional

class ReviewRequest(BaseModel):
    text: str
    reviewer: str
    writer_profile: Optional[str] = None

class ReviewResponse(BaseModel):
    reviewer: str
    critique: str
    suggestions: list[str]
