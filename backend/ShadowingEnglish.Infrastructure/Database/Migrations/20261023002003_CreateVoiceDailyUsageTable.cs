using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    /// <inheritdoc />
    public partial class CreateVoiceDailyUsageTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "VoiceDailyUsages",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DayUtc = table.Column<DateOnly>(type: "date", nullable: false),
                    TranscriptionRequests = table.Column<int>(type: "int", nullable: false),
                    SynthesisCharacters = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VoiceDailyUsages", x => new { x.UserId, x.DayUtc });
                    table.CheckConstraint("CK_VoiceDailyUsages_Nonnegative", "[TranscriptionRequests] >= 0 AND [SynthesisCharacters] >= 0");
                    table.ForeignKey(
                        name: "FK_VoiceDailyUsages_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VoiceDailyUsages");
        }
    }
}
