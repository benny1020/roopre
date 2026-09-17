import Foundation
import LocalAuthentication
let context = LAContext()
var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
    print("unavailable"); exit(2)
}
if CommandLine.arguments.contains("--check") { print("available"); exit(0) }
let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "루프리 설계 승인"
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
    print(success ? "authenticated" : "cancelled")
    exit(success ? 0 : 1)
}
RunLoop.main.run(until: Date(timeIntervalSinceNow: 120))
context.invalidate()
exit(3)
