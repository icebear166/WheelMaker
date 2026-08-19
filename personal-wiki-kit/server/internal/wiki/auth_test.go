package wiki

import "testing"

func TestPasswordHashRoundTrip(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple", argonParameters{
		memory: 8 * 1024, time: 1, threads: 1, keyLen: 32,
	})
	if err != nil {
		t.Fatalf("hashPassword() error = %v", err)
	}
	valid, err := VerifyPassword(encoded, "correct horse battery staple")
	if err != nil || !valid {
		t.Fatalf("VerifyPassword(correct) = %v, %v", valid, err)
	}
	valid, err = VerifyPassword(encoded, "incorrect password")
	if err != nil || valid {
		t.Fatalf("VerifyPassword(incorrect) = %v, %v", valid, err)
	}
}

func TestPasswordHashRejectsUnsafeParameters(t *testing.T) {
	encoded, err := hashPassword("correct horse battery staple", argonParameters{
		memory: 1024, time: 1, threads: 1, keyLen: 32,
	})
	if err != nil {
		t.Fatalf("hashPassword() error = %v", err)
	}
	if _, err := VerifyPassword(encoded, "correct horse battery staple"); err == nil {
		t.Fatal("VerifyPassword() accepted parameters below the safe memory floor")
	}
}
