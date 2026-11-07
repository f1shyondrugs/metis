import assert from "node:assert/strict";
import test from "node:test";
import {
  requiresProtectedCredentials as blocked, requiresProtectedCredentialInput,
  assertOrdinaryQuestionSafe, CredentialQuestionError, PROTECTED_CREDENTIAL_INPUT_MESSAGE,
} from "../lib/mcp-core/credential-question-policy.mjs";
import { ASK_USER_DESCRIPTION } from "../lib/mcp-core/question-schema.mjs";

test("ordinary forms reject password and login identities in German and English", () => {
  for (const question of ["Passwort", "Passwörter", "Kennwort", "Password", "PW", "Pass\u200bwort", "API key", "Zugangsdaten"]) {
    assert.equal(blocked({ questions: [{ question, type: "text" }] }), true, question);
  }
  for (const type of ["textarea", "select", "radio", "multiselect", "task_list", "number", "password"]) {
    assert.equal(blocked({ questions: [{ question: "Password", type }] }), true, type);
  }
  for (const question of ["Benutzername", "Nutzername", "E-Mail", "username", "email"]) {
    assert.equal(blocked({ title: "Anmeldung", questions: [{ question, type: "text" }] }), true, question);
  }
  assert.equal(blocked({ questions: [{ key: "loginPassword", question: "Eingabe" }] }), true);
  assert.equal(blocked({ title: "Zugangsdaten", questions: [{ question: "Eingabe" }] }), true);
  assert.match(ASK_USER_DESCRIPTION, /browser_request_login/);
});

test("credential value requests and label-only login fields require protected input", () => {
  const forms = [
    { questions: [{ question: "Bitte dein Kennwort eingeben." }] },
    { questions: [{ question: "What is your username?", type: "textarea" }] },
    { questions: [{ question: "Trage deinen Benutzernamen ein." }] },
    { questions: [{ question: "Benutzername oder E-Mail" }] },
    { questions: [{ question: "Benutzername für das Schulportal", key: "value" }] },
    { questions: [{ question: "Schulportal Passwort", key: "value" }] },
    { title: "Login", questions: [{ question: "Username for this website", key: "value" }] },
    { questions: [{ question: "Please provide your login credentials." }] },
    { questions: [{ question: "Bitte Zugangsdaten eingeben" }] },
    { title: "Sign in", questions: [{ question: "Email address" }] },
    { questions: [{ question: "E-Mail zum Anmelden" }] },
    { questions: [{ question: "Value", key: "api_key" }] },
    { questions: [{ question: "SSH private key", key: "value" }] },
    { questions: [{ question: "API key for OpenAI", key: "value" }] },
    { questions: [{ question: "Value", placeholder: "Enter password" }] },
    { questions: [{ question: "Value", group: "Credentials" }] },
    { questions: [{ question: "SSH target account", key: "password" }] },
    { question: "Password" },
  ];
  for (const form of forms) {
    assert.equal(blocked(form), true, JSON.stringify(form));
    assert.throws(() => assertOrdinaryQuestionSafe(form), error => error instanceof CredentialQuestionError
      && error.code === "protected_credentials_required" && error.message === PROTECTED_CREDENTIAL_INPUT_MESSAGE);
  }
  assert.equal(requiresProtectedCredentialInput, blocked);
});

test("task input, contact data, school choice, consent and numeric password length remain available", () => {
  const forms = [
    { questions: [{ question: "E-Mail für Rückfragen", type: "text" }] },
    { questions: [{ question: "Aufgaben", type: "task_list" }] },
    { questions: [{ question: "Passwort speichern?", type: "checkbox" }] },
    { questions: [{ question: "Password length", type: "number" }] },
    { title: "Anmeldung", questions: [{ question: "Welche Website URL?", type: "text" }] },
    { title: "Kontakt", questions: [{ question: "E-Mail-Adresse für die Antwort", key: "email" }] },
    { questions: [{ question: "Contact email address", key: "contact_email" }] },
    { title: "Schulportal-Anmeldung", questions: [{ question: "Welche Schule?", key: "school", type: "select", options: ["Schule A", "Schule B"] }] },
    { description: "Login benötigt Benutzername, E-Mail und Passwort.", questions: [{ question: "Welche Schule?", type: "text" }] },
    { description: "Password login is unavailable.", questions: [{ question: "Contact email", key: "email" }] },
    { questions: [{ question: "Welche Anleitung?", type: "radio", options: ["Passwort zurücksetzen", "Benutzername suchen"] }] },
    { questions: [{ question: "Soll das Passwort zurückgesetzt werden?", type: "radio", options: ["Ja", "Nein"] }] },
    { questions: [{ question: "How should passwords be stored?", type: "textarea" }] },
    { title: "Login", questions: [{ question: "Welche Passwort-Methode?", key: "method", options: ["SSO", "Passwort"] }] },
    { title: "Login", questions: [{ question: "Welches Format hat der Benutzername?", key: "format" }] },
    { title: "SSH-Verbindung", questions: [{ question: "SSH target account", key: "username" }] },
    { questions: [{ question: "SSH target account", key: "username", description: "Enter the SSH username" }] },
    { questions: [{ question: "Welches Linux-Konto ist das Ziel?", key: "user" }] },
    null, {}, { questions: [null] },
  ];
  for (const form of forms) {
    assert.equal(blocked(form), false, JSON.stringify(form));
    assert.doesNotThrow(() => assertOrdinaryQuestionSafe(form));
  }
});

test("explicit field instructions cannot hide credential requests behind generic labels", () => {
  for (const description of [
    "Enter your username and password",
    "Bitte dein Passwort eingeben.",
    "Please provide your access token",
    "Enter your email for login",
  ]) {
    assert.equal(blocked({ questions: [{ question: "Account details", key: "value", description }] }), true, description);
  }
  assert.equal(blocked({ questions: [{ question: "Which school?", description: "Login requires username and password." }] }), false);
  assert.equal(blocked({ questions: [{ question: "SSH target account", description: "Enter password" }] }), true);
});

test("console target metadata cannot exempt secret requests in field instructions", () => {
  for (const instructionField of ["description", "placeholder"]) {
    for (const instruction of ["Enter your username and password", "Enter your access token", "Passwort"]) {
      const form = { questions: [{ question: "SSH target account", key: "username", [instructionField]: instruction }] };
      assert.equal(blocked(form), true, JSON.stringify(form));
      assert.throws(() => assertOrdinaryQuestionSafe(form), CredentialQuestionError);
    }
  }
  assert.equal(blocked({ questions: [{ question: "SSH target account", key: "username", description: "Enter the SSH username" }] }), false);
});

test("rejection diagnostics never echo form text or defaults", () => {
  const marker = "TEST-NOT-A-REAL-CREDENTIAL";
  assert.throws(
    () => assertOrdinaryQuestionSafe({ title: marker, questions: [{ question: "Password", default: marker }] }),
    error => error instanceof CredentialQuestionError && !error.message.includes(marker),
  );
});
