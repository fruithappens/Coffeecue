"""Email through Microsoft Graph when it's configured (M365 has no password SMTP)."""
from unittest.mock import MagicMock, patch

from services import email_utils as eu

GRAPH = {
    "GRAPH_TENANT_ID": "t",
    "GRAPH_CLIENT_ID": "c",
    "GRAPH_CLIENT_SECRET": "s",
    "GRAPH_SENDER": "hello@cupq.com.au",
}


def test_not_configured_is_a_dry_run(monkeypatch):
    for k in list(GRAPH) + ["EMAIL_ENABLED"]:
        monkeypatch.delenv(k, raising=False)
    r = eu.send_html_email("x@y.com", "s", "<b>b</b>")
    assert r.ok and not r.sent


def test_graph_sends_as_the_mailbox(monkeypatch):
    for k, v in GRAPH.items():
        monkeypatch.setenv(k, v)
    eu._graph_token.update(value=None, expires=0)
    tok = MagicMock(status_code=200)
    tok.json.return_value = {"access_token": "AT", "expires_in": 3600}
    sent = MagicMock(status_code=202)
    with patch("requests.post", side_effect=[tok, sent]) as post:
        r = eu.send_html_email("steve@example.com", "Demo request", "<table></table>")
    assert r.ok and r.sent
    url, kwargs = post.call_args_list[1][0][0], post.call_args_list[1][1]
    assert url.endswith("/users/hello@cupq.com.au/sendMail")
    assert kwargs["headers"]["Authorization"] == "Bearer AT"
    assert (
        kwargs["json"]["message"]["toRecipients"][0]["emailAddress"]["address"]
        == "steve@example.com"
    )


def test_graph_refusal_is_reported_not_raised(monkeypatch):
    for k, v in GRAPH.items():
        monkeypatch.setenv(k, v)
    eu._graph_token.update(value="AT", expires=9e12)
    with patch("requests.post", return_value=MagicMock(status_code=403, text="denied")):
        r = eu.send_html_email("steve@example.com", "s", "b")
    assert not r.ok and not r.sent and "403" in r.detail
