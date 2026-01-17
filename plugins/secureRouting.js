export default function({ appendToId, appendToClass, appendToFunctionInScript, appendToFunctionAtMarker, backend, frontendDOM }) {

  //Replace all http:// with https://
  backend = backend.replace(/http:\/\//g, 'https://');

  //frontendDOM = frontendDOM.replace(/http:\/\//g, 'https://');

  //Replace the http import with https
  backend = backend.replace(
    /import\s+http,\s*\{\s*get\s*\}\s*from\s*["']http["'];?/g,
    'import http, { get } from "https";'
  );

  //Add certs to WebSocketServer initialization
  backend = backend.replace(
    /const\s+wss\s*=\s*new\s+WebSocketServer\(\s*\{\s*server\s*\}\s*\)/g,
    `const wss = new WebSocketServer({
  server,
  cert: fs.readFileSync(path.join(__dirname, "server.cert")),
  key: fs.readFileSync(path.join(__dirname, "server.key"))
})`
  );

    backend = backend.replace(
    /const\s+server\s*=\s*http\.createServer\s*\(\s*app\s*\);/g,
    `const options = {
  key: fs.readFileSync(path.join(__dirname, "server.key")),
  cert: fs.readFileSync(path.join(__dirname, "server.cert"))
};
const server = http.createServer(options, app);`
  );

  return { backend };

}
