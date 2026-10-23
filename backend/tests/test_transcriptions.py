def test_crud_flow(client):
    # Create
    created = client.post(
        "/api/transcriptions",
        json={"title": "Hello", "text": "नमस्ते, how are you?", "language": "hi"},
    )
    assert created.status_code == 201
    tid = created.json()["id"]

    # Read (list + detail)
    listing = client.get("/api/transcriptions").json()
    assert listing["total"] == 1
    assert client.get(f"/api/transcriptions/{tid}").json()["title"] == "Hello"

    # Search
    assert client.get("/api/transcriptions", params={"q": "how are"}).json()["total"] == 1
    assert client.get("/api/transcriptions", params={"q": "zzz"}).json()["total"] == 0

    # Update (only the sent field changes)
    updated = client.put(f"/api/transcriptions/{tid}", json={"title": "Renamed"}).json()
    assert updated["title"] == "Renamed"
    assert updated["text"] == "नमस्ते, how are you?"

    # Stats
    stats = client.get("/api/transcriptions/stats").json()
    assert stats["total"] == 1 and stats["manual"] == 1 and stats["total_words"] == 4

    # Delete
    assert client.delete(f"/api/transcriptions/{tid}").status_code == 204
    assert client.get(f"/api/transcriptions/{tid}").status_code == 404


def test_validation_and_missing_rows(client):
    assert client.post("/api/transcriptions", json={"title": ""}).status_code == 422
    assert client.put("/api/transcriptions/999", json={"title": "x"}).status_code == 404
    assert client.delete("/api/transcriptions/999").status_code == 404


def test_pagination(client):
    for i in range(5):
        client.post("/api/transcriptions", json={"title": f"n{i}", "text": "t"})
    page1 = client.get("/api/transcriptions", params={"page": 1, "page_size": 2}).json()
    page3 = client.get("/api/transcriptions", params={"page": 3, "page_size": 2}).json()
    assert len(page1["items"]) == 2 and page1["total"] == 5
    assert len(page3["items"]) == 1
