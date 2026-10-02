from flask import jsonify


def ok(data=None, message=None, status=200):
    body = {"success": True}
    if message:
        body["message"] = message
    if data is not None:
        body["data"] = data
    return jsonify(body), status


def error(message, status=400, code=None, details=None):
    body = {"success": False, "message": message}
    if code:
        body["code"] = code
    if details:
        body["details"] = details
    return jsonify(body), status
