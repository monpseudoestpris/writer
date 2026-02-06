# Use a Python base image
FROM python:3.10-slim-buster

# Set the working directory in the container
WORKDIR /app

# Copy the whole project root into /app
COPY . .

# Install the Python dependencies (from backend/requirements.txt)
RUN pip install --no-cache-dir -r backend/requirements.txt

# Add /app to PYTHONPATH so Python can find the 'backend' package
ENV PYTHONPATH=/app

# Expose the port that FastAPI will run on
EXPOSE 8000

# Command to run the FastAPI application
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]