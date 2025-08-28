import { describe, it, expect } from "vitest";
import { parse } from "./parser";
import { Severity } from "../result";
import "../../test/matchers";

describe("Define Block Parser", () => {
  describe("Basic define block parsing", () => {
    it("should parse empty define block", () => {
      const input = `
        name EmptyDefine;

        define {
        }

        storage {
        }

        code {
        }
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      expect(result.value.declarations).toHaveLength(0);
    });

    it("should parse define block with single struct", () => {
      const input = `
        name SingleStruct;

        define {
          struct User {
            addr: address;
            balance: uint256;
          };
        }

        storage {
          [0] owner: User;
        }

        code {
        }
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      // Should have 2 declarations: 1 struct from define, 1 storage
      expect(result.value.declarations).toHaveLength(2);

      const structDecl = result.value.declarations[0];
      expect(structDecl.type).toBe("Declaration");
      expect(structDecl.kind).toBe("struct");
      expect(structDecl.name).toBe("User");
      expect(structDecl.metadata?.fields).toHaveLength(2);

      const storageDecl = result.value.declarations[1];
      expect(storageDecl.kind).toBe("storage");
      expect(storageDecl.name).toBe("owner");
    });

    it("should parse define block with multiple structs", () => {
      const input = `
        name MultipleStructs;

        define {
          struct User {
            addr: address;
            balance: uint256;
          };

          struct Transaction {
            from: address;
            to: address;
            amount: uint256;
          };
        }

        storage {
          [0] owner: User;
          [1] lastTx: Transaction;
        }

        code {
        }
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      // Should have 4 declarations: 2 structs from define, 2 storage
      expect(result.value.declarations).toHaveLength(4);

      const userStruct = result.value.declarations[0];
      expect(userStruct.kind).toBe("struct");
      expect(userStruct.name).toBe("User");

      const txStruct = result.value.declarations[1];
      expect(txStruct.kind).toBe("struct");
      expect(txStruct.name).toBe("Transaction");
    });

    it("should work without define block", () => {
      const input = `
        name NoDefineBlock;

        storage {
          [0] count: uint256;
        }

        code {
          count = count + 1;
        }
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      // Should only have storage declaration
      expect(result.value.declarations).toHaveLength(1);
      expect(result.value.declarations[0].kind).toBe("storage");
    });
  });

  describe("Syntax requirements", () => {
    it("should require semicolons after struct declarations in define block", () => {
      const input = `
        name MissingSemicolon;

        define {
          struct User {
            addr: address;
            balance: uint256;
          }
          struct Transaction {
            from: address;
          };
        }

        storage {}
        code {}
      `;

      const result = parse(input);
      expect(result.success).toBe(false);
    });

    it("should reject struct declarations outside define block", () => {
      const input = `
        name StructOutsideDefine;

        struct User {
          addr: address;
        }

        define {
        }

        storage {}
        code {}
      `;

      const result = parse(input);
      expect(result.success).toBe(false);
    });

    it("should reject define keyword as identifier", () => {
      const input = `
        name DefineAsIdentifier;

        storage {
          [0] define: uint256;
        }

        code {}
      `;

      const result = parse(input);
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Parse should have failed");

      expect(result).toHaveMessage({
        severity: Severity.Error,
        message: "Cannot use keyword 'define' as identifier",
      });
    });
  });

  describe("Complex scenarios", () => {
    it("should parse nested struct references in define block", () => {
      const input = `
        name NestedStructs;

        define {
          struct Point {
            x: uint256;
            y: uint256;
          };

          struct Shape {
            center: Point;
            radius: uint256;
          };
        }

        storage {
          [0] circle: Shape;
        }

        code {
          circle.center.x = 100;
          circle.center.y = 200;
          circle.radius = 50;
        }
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      expect(result.value.declarations).toHaveLength(3); // 2 structs + 1 storage
    });

    it("should parse define block with empty structs", () => {
      const input = `
        name EmptyStructs;

        define {
          struct Empty {
          };

          struct AlsoEmpty {
          };
        }

        storage {}
        code {}
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      expect(result.value.declarations).toHaveLength(2);
      expect(result.value.declarations[0].metadata?.fields).toHaveLength(0);
      expect(result.value.declarations[1].metadata?.fields).toHaveLength(0);
    });

    it("should handle define block with comments", () => {
      const input = `
        name DefineWithComments;

        define {
          // User account structure
          struct User {
            addr: address;    // account address
            balance: uint256; // balance in wei
          };

          /* Transaction record */
          struct Transaction {
            from: address;
            to: address;
            amount: uint256;
          };
        }

        storage {}
        code {}
      `;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      expect(result.value.declarations).toHaveLength(2);
    });
  });

  describe("Source locations", () => {
    it("should track source locations for define block", () => {
      const input = `name DefineLocation;

define {
  struct User {
    addr: address;
  };
}

storage {}
code {}`;

      const result = parse(input);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("Parse failed");

      const structDecl = result.value.declarations[0];
      expect(structDecl.loc).not.toBeNull();
      expect(structDecl.loc?.offset).toBeGreaterThan(0);
      expect(structDecl.loc?.length).toBeGreaterThan(0);
    });
  });
});
