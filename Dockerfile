FROM python:3.12-slim

WORKDIR /app

COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY wss-jwt-server.py .

# Logs go to stdout (captured by Docker) + server.log volume if mounted
ENV PYTHONUNBUFFERED=1

EXPOSE 8765

CMD ["python", "wss-jwt-server.py"]
