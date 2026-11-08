"""Fresh action lease checks complement resource ownership and capability checks."""
import jwt
from app.auth.jwt_auth import _public_key, AuthError, error_response, ISSUER, AUDIENCE


def check_lease(request, action):
    token = request.headers.get("X-Authorization-Lease", "")
    if not token:
        return error_response(request,AuthError(403,"AUTHZ_LEASE_REQUIRED","A fresh authorization lease is required."))
    try:
        p = jwt.decode(token,_public_key(),algorithms=["RS256"],issuer=ISSUER,audience=AUDIENCE,
                       leeway=0,options={"require":["sub","exp","iat","action","tokenVersion","tokenType"]})
        if (p["tokenType"] != "LEASE" or p["action"] != action
                or p["sub"] != request.principal.user_id
                or p["tokenVersion"] != request.principal.token_version
                or type(p["iat"]) is not int or type(p["exp"]) is not int
                or not 0 < p["exp"]-p["iat"] <= 30):
            raise jwt.InvalidTokenError("Lease scope differs")
    except jwt.ExpiredSignatureError:
        return error_response(request,AuthError(401,"AUTHZ_LEASE_EXPIRED","Authorization lease expired."))
    except (jwt.InvalidTokenError,ValueError,KeyError,TypeError):
        return error_response(request,AuthError(403,"AUTHZ_LEASE_INVALID","Authorization lease is invalid."))
    return None


def require_lease(action):
    from functools import wraps
    def decorate(view):
        @wraps(view)
        def guarded(request,*args,**kwargs):
            failure=check_lease(request,action)
            return failure if failure is not None else view(request,*args,**kwargs)
        return guarded
    return decorate
