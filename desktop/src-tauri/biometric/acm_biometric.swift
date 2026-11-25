import Foundation
import LocalAuthentication

// acm_biometric check -> exit 0 若支持生物识别
// acm_biometric auth  -> 请求 Touch ID，成功 exit 0
let args = CommandLine.arguments
let cmd = args.count > 1 ? args[1] : ""
let ctx = LAContext()
ctx.localizedReason = "AI 积分管家验证指纹以查看密钥"
var err: NSError?
guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { exit(2) }
if cmd == "check" { exit(0) }
let sem = DispatchSemaphore(value: 0); var ok = false
ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "验证指纹以查看 API Key") { success, _ in
    ok = success; sem.signal()
}
sem.wait()
exit(ok ? 0 : 3)
