using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261005134000_AddAiProviderManagement")]
public partial class AddAiProviderManagement : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "AiProviderConfigurations",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Capability = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                ProviderKey = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                EncryptedApiKey = table.Column<string>(type: "nvarchar(max)", maxLength: 4096, nullable: true),
                KeyLast4 = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: true),
                AccountId = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                ProjectId = table.Column<string>(type: "nvarchar(160)", maxLength: 160, nullable: true),
                Model = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                Priority = table.Column<int>(type: "int", nullable: false),
                Enabled = table.Column<bool>(type: "bit", nullable: false),
                Status = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                LastSuccessfulRequestUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                LastFailedRequestUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                LastFailureReason = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                UpdatedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                Revision = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                LastMutationRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                LastMutationRequestHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AiProviderConfigurations", x => x.Id);
                table.CheckConstraint("CK_AiProviderConfigurations_Priority", "[Priority] BETWEEN 1 AND 100");
                table.ForeignKey(
                    name: "FK_AiProviderConfigurations_AspNetUsers_UpdatedByAdminId",
                    column: x => x.UpdatedByAdminId,
                    principalTable: "AspNetUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "AiProviderAuditEntries",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProviderConfigurationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Capability = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                ProviderKey = table.Column<string>(type: "nvarchar(48)", maxLength: 48, nullable: false),
                Action = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                ResultCode = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                ActorAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                OccurredAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AiProviderAuditEntries", x => x.Id);
                table.ForeignKey(
                    name: "FK_AiProviderAuditEntries_AiProviderConfigurations_ProviderConfigurationId",
                    column: x => x.ProviderConfigurationId,
                    principalTable: "AiProviderConfigurations",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_AiProviderAuditEntries_AspNetUsers_ActorAdminId",
                    column: x => x.ActorAdminId,
                    principalTable: "AspNetUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_AiProviderConfigurations_Capability_Enabled_Priority",
            table: "AiProviderConfigurations",
            columns: new[] { "Capability", "Enabled", "Priority" });

        migrationBuilder.CreateIndex(
            name: "IX_AiProviderConfigurations_Capability_ProviderKey",
            table: "AiProviderConfigurations",
            columns: new[] { "Capability", "ProviderKey" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_AiProviderConfigurations_UpdatedByAdminId",
            table: "AiProviderConfigurations",
            column: "UpdatedByAdminId");

        migrationBuilder.CreateIndex(
            name: "IX_AiProviderAuditEntries_ActorAdminId",
            table: "AiProviderAuditEntries",
            column: "ActorAdminId");

        migrationBuilder.CreateIndex(
            name: "IX_AiProviderAuditEntries_ProviderConfigurationId_OccurredAtUtc",
            table: "AiProviderAuditEntries",
            columns: new[] { "ProviderConfigurationId", "OccurredAtUtc" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "AiProviderAuditEntries");
        migrationBuilder.DropTable(name: "AiProviderConfigurations");
    }
}
