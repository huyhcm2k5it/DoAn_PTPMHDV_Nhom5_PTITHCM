package httpadapter

import (
 "context"
"encoding/json"
 "strings"
 "github.com/labstack/echo/v5"
 "umccare/diagnostic/internal/domain"
)

// RecoveryBoundary is supplied only in an operator-enabled recovery profile.
// It authenticates a distinct SERVICE[Clinical] credential and reads a verified
// Clinical owner export; user JWT authentication is deliberately not reused.
type RecoveryBoundary interface {
 AuthenticateClinical(context.Context,string) error
 VerifiedRequest(context.Context,string,string)(domain.Envelope,error)
}
type RecoveryHandler interface {
 Handle(context.Context,string,string,domain.Envelope) error
}
func registerRecovery(e *echo.Echo,o Options) {
 if o.Recovery==nil{return}
 e.POST("/api/v1/diagnostic-orders",func(c *echo.Context) error {
  h:=strings.Fields(c.Request().Header.Get("Authorization"))
  if len(h)!=2||!strings.EqualFold(h[0],"Bearer"){return domain.Fail("FORBIDDEN","Clinical service credential required")}
  if err:=o.Recovery.AuthenticateClinical(c.Request().Context(),h[1]);err!=nil{return domain.Fail("FORBIDDEN","Clinical service credential required")}
  var in struct {RequestID string `json:"requestId"`; RequestHash string `json:"requestHash"`}
  if err:=decode(c,&in);err!=nil{return err}
  if !domain.ValidID(in.RequestID)||len(in.RequestHash)!=64{return domain.Fail("VALIDATION_ERROR","Registry request identity and hash required")}
  m,err:=o.Recovery.VerifiedRequest(c.Request().Context(),in.RequestID,in.RequestHash)
  if err!=nil{return domain.Fail("FORBIDDEN","Verified Clinical registry request required")}
  var command struct {RequestID string `json:"requestId"`;RequestHash string `json:"requestHash"`}
  // The full command is subsequently validated by the same broker handler.
  if err:=json.Unmarshal(m.Payload,&command);err!=nil||command.RequestID!=in.RequestID||command.RequestHash!=in.RequestHash||m.RequestID!=in.RequestID{return domain.Fail("FORBIDDEN","Registry evidence mismatch")}
  handler,ok:=o.App.(RecoveryHandler);if !ok{return domain.Fail("SERVICE_UNAVAILABLE","Recovery handler unavailable")}
  if err=handler.Handle(c.Request().Context(),"umc.commands.clinical.v1","diagnostic.create-lab-order.v1",m);err!=nil{return err}
  return c.JSON(202,map[string]any{"data":map[string]string{"requestId":in.RequestID,"state":"PENDING"}})
 })
}
