"""Real OpenSSH client against a local mock SSH server; no real credentials.
Local PAM fixtures exercise real PTYs but never authenticate an OS account.
"""
import base64
import importlib.util
import logging
import os
from pathlib import Path
import re
import socket
import tempfile
import threading
import time
import unittest
import paramiko

logging.getLogger("paramiko").setLevel(logging.CRITICAL)
spec=importlib.util.spec_from_file_location("console",Path(__file__).parents[1]/"services/secure-console/server.py")
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)
SSH_PASSWORD="TEST-SSH-ONLY-5748"
PAM_PASSWORD="TEST-PAM-ONLY-0912"


class MockAuth(paramiko.ServerInterface):
    def __init__(self):self.command=None;self.event=threading.Event()
    def get_allowed_auths(self,username):return "password"
    def check_auth_password(self,username,password):return paramiko.AUTH_SUCCESSFUL if username=="root" and password==SSH_PASSWORD else paramiko.AUTH_FAILED
    def check_channel_request(self,kind,chanid):return paramiko.OPEN_SUCCEEDED if kind=="session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
    def check_channel_pty_request(self,*args):return True
    def check_channel_exec_request(self,channel,command):self.command=command.decode();self.event.set();return True


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="metis-console-test-");console.STATE=Path(self.temp.name)
        self.sessions=[]
    def tearDown(self):
        for session in self.sessions:session.close()
        console.SESSIONS.clear();self.temp.cleanup()
    def ready(self,session):
        for _ in range(100):
            if session.ready:return
            time.sleep(.05)
        self.fail("Console did not finish authentication")
    def test_real_ssh_is_private_and_bound_and_rejects_inplace_elevation(self):
        key=paramiko.RSAKey.generate(2048)
        listener=socket.socket();listener.bind(("127.0.0.1",0));listener.listen(10);listener.settimeout(.2)
        stopped=threading.Event();transports=[]
        def handle(client):
            transport=paramiko.Transport(client);transports.append(transport);transport.add_server_key(key);auth=MockAuth()
            try:
                transport.start_server(server=auth);channel=transport.accept(10)
                if channel is None or not auth.event.wait(5):return
                marker=re.search(r"METIS_AUTH_[a-f0-9]+",auth.command).group()
                channel.sendall(("\x1e"+marker+"\x1f\r\nmock-root$ ").encode())
                buffer="";awaiting=None
                while not stopped.is_set():
                    data=channel.recv(4096)
                    if not data:break
                    buffer+=data.decode(errors="replace")
                    while "\n" in buffer:
                        line,buffer=buffer.split("\n",1);line=line.strip()
                        if awaiting:
                            if line!=PAM_PASSWORD:channel.close();return
                            channel.sendall(("\x1e"+awaiting+"\x1f\r\nmock-root$ ").encode());awaiting=None
                        elif line.startswith(("/usr/bin/sudo ","/usr/bin/su ")):
                            awaiting=re.search(r"METIS_AUTH_[a-f0-9]+",line).group()
                            # Echo includes the nonce's textual spelling but must
                            # NOT mark auth complete before the framed marker.
                            channel.sendall((line+"\r\nPassword: ").encode())
                        elif line=="whoami":channel.sendall(b"root\r\nmock-root$ ")
                        elif line=="echo-secret":
                            for secret in [SSH_PASSWORD,base64.b64encode(SSH_PASSWORD.encode()).decode()]:
                                channel.sendall(secret[:5].encode());time.sleep(.01);channel.sendall((secret[5:]+"\r\n").encode())
                        else:channel.sendall(b"mock-root$ ")
            except Exception:pass
            finally:transport.close()
        def serve():
            while not stopped.is_set():
                try:client,_=listener.accept()
                except socket.timeout:continue
                except OSError:return
                threading.Thread(target=handle,args=(client,),daemon=True).start()
        threading.Thread(target=serve,daemon=True).start()
        try:
            session=console.Session("alice","chat","ssh","root","127.0.0.1",listener.getsockname()[1]);self.sessions.append(session);console.SESSIONS[("alice","chat")]=session
            request=session.prepare();self.assertEqual(request["status"],"input_required",request);self.assertIn("SHA256:",request["label"])
            self.assertIn('"ssh"',request["target"])
            with self.assertRaises(ValueError):console.dispatch({"owner":"alice","chat":"chat","operation":"input","input":{"command":"whoami"}})
            with self.assertRaises(ValueError):console.dispatch({"owner":"bob","chat":"chat","operation":"fill","input":{"requestId":request["secureInput"]["requestId"],"password":SSH_PASSWORD}})
            session.fill(request["secureInput"]["requestId"],SSH_PASSWORD);self.ready(session)
            console.dispatch({"owner":"alice","chat":"chat","operation":"input","input":{"command":"whoami"}});time.sleep(.1);self.assertIn("root",session.clean())
            for method in ["sudo", "su"]:
                with self.assertRaisesRegex(ValueError, "existing SSH terminal"):
                    session.elevate(method, "other")
                self.assertTrue(session.ready)
            console.dispatch({"owner":"alice","chat":"chat","operation":"input","input":{"command":"echo-secret"}});time.sleep(.2)
            output=session.clean();self.assertNotIn(SSH_PASSWORD,output);self.assertNotIn(PAM_PASSWORD,output);self.assertNotIn(base64.b64encode(PAM_PASSWORD.encode()).decode(),output);self.assertIn("REDACTED",output)
            with self.assertRaises(ValueError):session.fill(request["secureInput"]["requestId"],SSH_PASSWORD)
        finally:
            stopped.set();listener.close()
            for transport in transports:transport.close()
    def test_local_su_sudo_use_real_noecho_pty_but_only_mock_auth_programs(self):
        original=os.execve
        for method in ["su","sudo"]:
            def fixture_exec(file,args,environment):
                assert file=="/usr/bin/"+method
                marker=re.search(r"METIS_AUTH_[a-f0-9]+",args[-1]).group()
                program="import os,sys,termios; a=termios.tcgetattr(0);a[3]&=~termios.ECHO;termios.tcsetattr(0,termios.TCSANOW,a);sys.stdout.write('Password: ');sys.stdout.flush();value=sys.stdin.readline().strip();assert value=='TEST-PAM-ONLY-0912';os.write(1,('\\x1e'+sys.argv[1]+'\\x1f').encode());sys.stdin.read()"
                original("/usr/bin/python3",["python3","-c",program,marker],environment)
            os.execve=fixture_exec
            try:session=console.Session("alice",method,method,"root");self.sessions.append(session)
            finally:os.execve=original
            request=session.prepare();self.assertEqual(request["status"],"input_required")
            session.fill(request["secureInput"]["requestId"],PAM_PASSWORD);self.ready(session)
            self.assertNotIn(PAM_PASSWORD,session.clean());session.close()


if __name__=="__main__":unittest.main(verbosity=2)
